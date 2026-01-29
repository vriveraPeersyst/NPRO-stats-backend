import { prisma } from '../db/prisma.js';
import { CONSTANTS } from '../config/env.js';
import { fetchNearPrice } from '../services/nearMobileApi.js';
import { fetchLiquidityData } from '../services/dexscreener.js';
import { getValidatorStats, getTrackedAccountBalances, getFtBalance } from '../services/nearFt.js';
import { writeSnapshot } from '../utils/snapshots.js';
import { getNearRpcManager } from '../services/nearRpcManager.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Fast Sync
// Runs every 5 minutes
// - NEAR Mobile API for NEAR price
// - DexScreener liquidity/volume/txns (includes NPRO price)
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
  // 1. Fetch Liquidity Data from DexScreener (includes NPRO price)
  // ─────────────────────────────────────────────────────────────────────────────
  let nproPriceUsd = 0;
  let nearPriceUsd = 0;

  try {
    console.log('📊 Fetching liquidity data from DexScreener...');
    const liquidityData = await fetchLiquidityData();
    nproPriceUsd = liquidityData.rhea.priceUsd;

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
    console.log(`✅ Liquidity data updated. NPRO: $${nproPriceUsd}, TVL: $${liquidityData.rhea.tvlUsd.toFixed(2)}`);
  } catch (error) {
    const message = `Liquidity error: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`❌ ${message}`);
    errors.push(message);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Fetch NEAR Price from NEAR Mobile API
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    console.log('📊 Fetching NEAR price from NEAR Mobile API...');
    const nearPriceData = await fetchNearPrice();
    nearPriceUsd = nearPriceData.usd;

    // Build complete token prices using DexScreener for NPRO, NEAR Mobile API for NEAR
    const nproInNear = nearPriceUsd > 0 ? nproPriceUsd / nearPriceUsd : 0;
    
    // Get NPRO change24h from liquidity data (priceChange24hPct)
    const liquidityMetric = await prisma.metricCurrent.findUnique({
      where: { key: CONSTANTS.METRIC_KEYS.LIQUIDITY_STATS },
    });
    
    let nproChange24h = 0;
    let nproMarketCap = 0;
    let nproFdv = 0;
    
    if (liquidityMetric?.value && typeof liquidityMetric.value === 'object') {
      const liquidityValue = liquidityMetric.value as any;
      nproChange24h = liquidityValue.rhea?.priceChange24hPct || 0;
      nproMarketCap = liquidityValue.rhea?.marketCap || 0;
      nproFdv = liquidityValue.rhea?.fdv || 0;
    }

    // Calculate NPRO/NEAR 24h change
    const nproYesterday = nproPriceUsd / (1 + nproChange24h / 100);
    const nearYesterday = nearPriceUsd / (1 + nearPriceData.change24h / 100);
    const nproInNearYesterday = nearYesterday > 0 ? nproYesterday / nearYesterday : 0;
    const nproInNearChange24h = nproInNearYesterday > 0 
      ? ((nproInNear - nproInNearYesterday) / nproInNearYesterday) * 100 
      : 0;

    const combinedPriceData = {
      npro: {
        usd: nproPriceUsd,
        change24h: nproChange24h,
        change7d: 0, // Not available from DexScreener
        change30d: 0, // Not available from DexScreener
        marketCap: nproMarketCap,
        fdv: nproFdv,
        circulatingSupply: nproMarketCap > 0 && nproPriceUsd > 0 ? nproMarketCap / nproPriceUsd : 0,
      },
      near: {
        usd: nearPriceUsd,
        change24h: nearPriceData.change24h,
        change7d: 0, // Not available from NEAR Mobile API
        change30d: 0, // Not available from NEAR Mobile API
      },
      nproInNear,
      nproInNearChange24h,
    };

    await prisma.metricCurrent.upsert({
      where: { key: CONSTANTS.METRIC_KEYS.TOKEN_PRICES },
      update: {
        value: combinedPriceData as any,
      },
      create: {
        key: CONSTANTS.METRIC_KEYS.TOKEN_PRICES,
        value: combinedPriceData as any,
      },
    });

    metrics.tokenPrices = true;
    console.log(`✅ Token prices updated. NPRO: $${nproPriceUsd}, NEAR: $${nearPriceUsd}`);
  } catch (error) {
    const message = `NEAR price error: ${error instanceof Error ? error.message : String(error)}`;
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
