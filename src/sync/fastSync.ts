import { prisma } from '../db/prisma.js';
import { CONSTANTS } from '../config/env.js';
import { fetchTokenPrices } from '../services/coingecko.js';
import { fetchLiquidityData } from '../services/dexscreener.js';
import { getValidatorStats, getTrackedAccountBalances, getFtBalance } from '../services/nearFt.js';
import { writeSnapshot } from '../utils/snapshots.js';
import { getNearRpcManager } from '../services/nearRpcManager.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Fast Sync
// Runs every 5 minutes
// - CoinGecko token prices
// - DexScreener liquidity/volume/txns
// - NEAR RPC: validator stats + account balances
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface FastSyncResult {
  success: boolean;
  duration: number;
  errors: string[];
  metrics: {
    tokenPrices: boolean;
    liquidity: boolean;
    validator: boolean;
    accountBalances: boolean;
  };
}

export async function runFastSync(): Promise<FastSyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const metrics = {
    tokenPrices: false,
    liquidity: false,
    validator: false,
    accountBalances: false,
  };

  console.log('🚀 Starting fast sync...');

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Fetch Token Prices from CoinGecko
  // ─────────────────────────────────────────────────────────────────────────────
  let nproPriceUsd = 0;

  try {
    console.log('📊 Fetching token prices from CoinGecko...');
    const priceData = await fetchTokenPrices();
    nproPriceUsd = priceData.npro.usd;

    await prisma.metricCurrent.upsert({
      where: { key: CONSTANTS.METRIC_KEYS.TOKEN_PRICES },
      update: {
        value: priceData as any,
      },
      create: {
        key: CONSTANTS.METRIC_KEYS.TOKEN_PRICES,
        value: priceData as any,
      },
    });

    metrics.tokenPrices = true;
    console.log(`✅ Token prices updated. NPRO: $${nproPriceUsd}`);
  } catch (error) {
    const message = `Token prices error: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`❌ ${message}`);
    errors.push(message);

    // Try to get existing price for other operations
    try {
      const existing = await prisma.metricCurrent.findUnique({
        where: { key: CONSTANTS.METRIC_KEYS.TOKEN_PRICES },
      });
      if (existing?.value && typeof existing.value === 'object') {
        const value = existing.value as { npro?: { usd?: number } };
        nproPriceUsd = value.npro?.usd || 0;
      }
    } catch {
      // Ignore
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Fetch Liquidity Data from DexScreener
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    console.log('📊 Fetching liquidity data from DexScreener...');
    const liquidityData = await fetchLiquidityData();

    // Add intents balance
    const intentsBalance = await getFtBalance(
      CONSTANTS.NPRO_CONTRACT,
      CONSTANTS.TRACKED_ACCOUNTS.intents,
      nproPriceUsd
    );

    const fullLiquidityData = {
      ...liquidityData,
      intentsBalance,
    };

    await prisma.metricCurrent.upsert({
      where: { key: CONSTANTS.METRIC_KEYS.LIQUIDITY_STATS },
      update: {
        value: fullLiquidityData as any,
      },
      create: {
        key: CONSTANTS.METRIC_KEYS.LIQUIDITY_STATS,
        value: fullLiquidityData as any,
      },
    });

    // Snapshot TVL and volume for 24h delta calculations
    await writeSnapshot(CONSTANTS.SNAPSHOT_KEYS.RHEA_TVL_USD, liquidityData.rhea.tvlUsd);
    await writeSnapshot(CONSTANTS.SNAPSHOT_KEYS.RHEA_VOLUME_H24, liquidityData.rhea.volume24h);

    metrics.liquidity = true;
    console.log(`✅ Liquidity data updated. TVL: $${liquidityData.rhea.tvlUsd.toFixed(2)}`);
  } catch (error) {
    const message = `Liquidity error: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`❌ ${message}`);
    errors.push(message);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Fetch Validator Stats from NEAR RPC
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    console.log('📊 Fetching validator stats from NEAR RPC...');
    const validatorStats = await getValidatorStats();

    await prisma.metricCurrent.upsert({
      where: { key: CONSTANTS.METRIC_KEYS.VALIDATOR_STATS },
      update: {
        value: validatorStats as any,
      },
      create: {
        key: CONSTANTS.METRIC_KEYS.VALIDATOR_STATS,
        value: validatorStats as any,
      },
    });

    metrics.validator = true;
    console.log(
      `✅ Validator stats updated. Staked: ${validatorStats.stakedBalance.number.toFixed(2)} NEAR`
    );
  } catch (error) {
    const message = `Validator error: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`❌ ${message}`);
    errors.push(message);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Fetch Account Balances from NEAR RPC
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    console.log('📊 Fetching account balances from NEAR RPC...');
    const accountBalances = await getTrackedAccountBalances(nproPriceUsd);
    const rpcManager = getNearRpcManager();

    await prisma.metricCurrent.upsert({
      where: { key: CONSTANTS.METRIC_KEYS.ACCOUNT_BALANCES },
      update: {
        value: {
          ...accountBalances,
          rpcUrlUsed: rpcManager.getCurrentUrl(),
        } as any,
      },
      create: {
        key: CONSTANTS.METRIC_KEYS.ACCOUNT_BALANCES,
        value: {
          ...accountBalances,
          rpcUrlUsed: rpcManager.getCurrentUrl(),
        } as any,
      },
    });

    metrics.accountBalances = true;
    console.log('✅ Account balances updated');
  } catch (error) {
    const message = `Account balances error: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`❌ ${message}`);
    errors.push(message);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Update sync state
  // ─────────────────────────────────────────────────────────────────────────────
  const success = errors.length === 0;
  const duration = Date.now() - startTime;

  await prisma.syncState.upsert({
    where: { type: 'fast' },
    update: {
      lastRunAt: new Date(),
      status: success ? 'success' : 'error',
      error: success ? null : errors.join('; '),
    },
    create: {
      type: 'fast',
      lastRunAt: new Date(),
      status: success ? 'success' : 'error',
      error: success ? null : errors.join('; '),
    },
  });

  console.log(
    `🏁 Fast sync completed in ${duration}ms. Success: ${success}, Errors: ${errors.length}`
  );

  return {
    success,
    duration,
    errors,
    metrics,
  };
}
