import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/prisma.js';
import { CONSTANTS } from '../config/env.js';
import { getSnapshotWithDelta } from '../utils/snapshots.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Public API Routes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface SummaryResponse {
  asOf: {
    fast: string | null;
    slow: string | null;
    premium: string | null;
  };
  token: {
    npro: {
      usd: number;
      change24h: number;
      change7d: number;
      change30d: number;
      marketCap: number;
      fdv: number;
      circulatingSupply: number;
    };
    near: {
      usd: number;
      change24h: number;
      change7d: number;
      change30d: number;
    };
    nproInNear: number;
    nproInNearChange24h: number;
  } | null;
  validator: {
    /** Actively staked NEAR earning rewards */
    staked: {
      raw: string;
      formatted: string;
      number: number;
    };
    /** Unstaked NEAR (in cooldown or ready to withdraw - cannot differentiate at pool level) */
    unstaked: {
      raw: string;
      formatted: string;
      number: number;
    };
    /** Total NEAR in validator (staked + unstaked) */
    total: {
      raw: string;
      formatted: string;
      number: number;
    };
    rpcUrlUsed: string;
  } | null;
  nearblocks: {
    holders: {
      count: number;
      delta24h: number;
    };
    transfers: {
      count: number;
      delta24h: number;
    };
  } | null;
  accounts: Record<
    string,
    {
      raw: string;
      formatted: string;
      number: number;
      usdValue: number;
    }
  > | null;
  liquidity: {
    rhea: {
      tvlUsd: number;
      delta24h: number;
      volume24h: number;
      deltaVolume24h: number;
      buys24h: number;
      sells24h: number;
      totalTxns24h: number;
      baseNpro: number;
      quoteNear: number;
      /** Pool composition with base/quote token details */
      pool: {
        base: {
          symbol: string;
          address: string;
          amount: number;
          usdValue: number;
          pct: number;
        };
        quote: {
          symbol: string;
          address: string;
          amount: number;
          usdValue: number;
          pct: number;
        };
      };
      priceUsd: number;
      priceNative: number;
      priceChange24hPct: number;
      pairUrl: string;
      marketCap: number;
      fdv: number;
    };
    intents: {
      raw: string;
      formatted: number;
      usdValue: number;
    } | null;
  } | null;
  premium: {
    premiumUsers: number;
    premiumUsersChange24h: number;
    ambassadorUsers: number;
    ambassadorUsersChange24h: number;
    premiumSubscriptions24h: number;
    ambassadorSubscriptions24h: number;
    upgrades24h: number;
    unsubscribes24h: number;
    paidUsers: number;
    totalTransactions: number;
    locked: {
      premium: number;
      ambassador: number;
      total: number;
    };
    /** Locked amounts in USD */
    lockedUsdValue: {
      premium: number;
      ambassador: number;
      total: number;
    };
  } | null;
  richList: Array<{
    rank: number;
    account: string;
    balance: {
      raw: string;
      formatted: string;
      number: number;
      usdValue: number;
    };
  }> | null;
}

export async function registerPublicRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Health check endpoint
   */
  app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Check database connection
      await prisma.$queryRaw`SELECT 1`;

      return reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: 'connected',
      });
    } catch (error) {
      app.log.error({ error }, 'Health check failed');
      return reply.status(503).send({
        status: 'error',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * Main summary endpoint - returns all NPRO dashboard data
   */
  app.get('/v1/npro/summary', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get all sync states
      const syncStates = await prisma.syncState.findMany();
      const syncStateMap = new Map(syncStates.map((s: any) => [s.type, s]));

      // Get all current metrics
      const metrics = await prisma.metricCurrent.findMany();
      const metricsMap = new Map(metrics.map((m: any) => [m.key, m.value]));

      // Get delta snapshots for liquidity
      const tvlDelta = await getSnapshotWithDelta(CONSTANTS.SNAPSHOT_KEYS.RHEA_TVL_USD);
      const volumeDelta = await getSnapshotWithDelta(CONSTANTS.SNAPSHOT_KEYS.RHEA_VOLUME_H24);

      // Get NPRO price for USD calculations
      const tokenPrices = metricsMap.get(CONSTANTS.METRIC_KEYS.TOKEN_PRICES) as SummaryResponse['token'] | undefined;
      const nproPriceUsd = tokenPrices?.npro?.usd || 0;

      // Build response
      const response: SummaryResponse = {
        asOf: {
          fast: (syncStateMap.get('fast') as any)?.lastRunAt?.toISOString() || null,
          slow: (syncStateMap.get('slow') as any)?.lastRunAt?.toISOString() || null,
          premium: (syncStateMap.get('premium') as any)?.lastRunAt?.toISOString() || null,
        },
        token: tokenPrices || null,
        validator: buildValidatorResponse(metricsMap.get(CONSTANTS.METRIC_KEYS.VALIDATOR_STATS)),
        nearblocks:
          (metricsMap.get(CONSTANTS.METRIC_KEYS.NEARBLOCKS_STATS) as SummaryResponse['nearblocks']) ||
          null,
        accounts:
          (metricsMap.get(CONSTANTS.METRIC_KEYS.ACCOUNT_BALANCES) as SummaryResponse['accounts']) ||
          null,
        liquidity: buildLiquidityResponse(
          metricsMap.get(CONSTANTS.METRIC_KEYS.LIQUIDITY_STATS),
          tvlDelta.delta24h,
          volumeDelta.delta24h
        ),
        premium: buildPremiumResponse(metricsMap.get(CONSTANTS.METRIC_KEYS.PREMIUM_STATS), nproPriceUsd),
        richList: (metricsMap.get(CONSTANTS.METRIC_KEYS.RICH_LIST) as SummaryResponse['richList']) || null,
      };

      return reply.send(response);
    } catch (error) {
      app.log.error({ error }, 'Summary endpoint error');
      return reply.status(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * Get lists of premium and ambassador user addresses
   */
  app.get('/v1/npro/users', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get all users with their tiers
      const users = await prisma.premiumUser.findMany({
        where: {
          tier: {
            in: ['PREMIUM', 'AMBASSADOR'],
          },
        },
        select: {
          accountId: true,
          tier: true,
          updatedAt: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      const premiumAddresses = users
        .filter((u) => u.tier === 'PREMIUM')
        .map((u) => u.accountId);

      const ambassadorAddresses = users
        .filter((u) => u.tier === 'AMBASSADOR')
        .map((u) => u.accountId);

      return reply.send({
        premium: {
          count: premiumAddresses.length,
          addresses: premiumAddresses,
        },
        ambassador: {
          count: ambassadorAddresses.length,
          addresses: ambassadorAddresses,
        },
        total: users.length,
        lastUpdated: users.length > 0 ? users[0].updatedAt.toISOString() : null,
      });
    } catch (error) {
      app.log.error({ error }, 'Failed to fetch user lists');
      return reply.status(500).send({
        error: 'Failed to fetch user lists',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}

function buildValidatorResponse(
  data: unknown
): SummaryResponse['validator'] | null {
  if (!data || typeof data !== 'object') return null;

  const d = data as Record<string, unknown>;
  const stakedBalance = d.stakedBalance as Record<string, unknown> | undefined;
  const unstakedBalance = d.unstakedBalance as Record<string, unknown> | undefined;
  const totalBalance = d.totalBalance as Record<string, unknown> | undefined;

  return {
    staked: {
      raw: String(stakedBalance?.raw || '0'),
      formatted: String(stakedBalance?.formatted || '0'),
      number: Number(stakedBalance?.number || 0),
    },
    unstaked: {
      raw: String(unstakedBalance?.raw || '0'),
      formatted: String(unstakedBalance?.formatted || '0'),
      number: Number(unstakedBalance?.number || 0),
    },
    total: {
      raw: String(totalBalance?.raw || '0'),
      formatted: String(totalBalance?.formatted || '0'),
      number: Number(totalBalance?.number || 0),
    },
    rpcUrlUsed: String(d.rpcUrlUsed || 'unknown'),
  };
}

function buildLiquidityResponse(
  data: unknown,
  tvlDelta24h: number,
  volumeDelta24h: number
): SummaryResponse['liquidity'] | null {
  if (!data || typeof data !== 'object') return null;

  const d = data as Record<string, unknown>;
  const rhea = d.rhea as Record<string, unknown> | undefined;
  const intentsBalance = d.intentsBalance as Record<string, unknown> | undefined;

  if (!rhea) return null;

  const tvlUsd = Number(rhea.tvlUsd || 0);
  const baseNpro = Number(rhea.baseNpro || 0);
  const quoteNear = Number(rhea.quoteNear || 0);
  const priceUsd = Number(rhea.priceUsd || 0);
  const priceNative = Number(rhea.priceNative || 0);

  // Calculate USD values for pool composition
  const baseUsdValue = baseNpro * priceUsd;
  const quoteUsdValue = priceNative > 0 ? quoteNear * (priceUsd / priceNative) : 0;
  const totalPoolUsd = baseUsdValue + quoteUsdValue;

  return {
    rhea: {
      tvlUsd,
      delta24h: tvlDelta24h,
      volume24h: Number(rhea.volume24h || 0),
      deltaVolume24h: volumeDelta24h,
      buys24h: Number(rhea.buys24h || 0),
      sells24h: Number(rhea.sells24h || 0),
      totalTxns24h: Number(rhea.totalTxns24h || 0),
      baseNpro,
      quoteNear,
      pool: {
        base: {
          symbol: 'NPRO',
          address: 'npro.nearmobile.near',
          amount: baseNpro,
          usdValue: baseUsdValue,
          pct: totalPoolUsd > 0 ? (baseUsdValue / totalPoolUsd) * 100 : 50,
        },
        quote: {
          symbol: 'NEAR',
          address: 'wrap.near',
          amount: quoteNear,
          usdValue: quoteUsdValue,
          pct: totalPoolUsd > 0 ? (quoteUsdValue / totalPoolUsd) * 100 : 50,
        },
      },
      priceUsd,
      priceNative,
      priceChange24hPct: Number(rhea.priceChange24hPct || 0),
      pairUrl: String(rhea.pairUrl || ''),
      marketCap: Number(rhea.marketCap || 0),
      fdv: Number(rhea.fdv || 0),
    },
    intents: intentsBalance
      ? {
          raw: String(intentsBalance.raw || '0'),
          formatted: Number(intentsBalance.number || 0),
          usdValue: Number(intentsBalance.usdValue || 0),
        }
      : null,
  };
}

function buildPremiumResponse(
  data: unknown,
  nproPriceUsd: number = 0
): SummaryResponse['premium'] | null {
  if (!data || typeof data !== 'object') return null;

  const d = data as Record<string, unknown>;
  const locked = d.locked as Record<string, unknown> | undefined;

  const lockedPremium = Number(locked?.premium || 0);
  const lockedAmbassador = Number(locked?.ambassador || 0);
  const lockedTotal = Number(locked?.total || 0);

  return {
    premiumUsers: Number(d.premiumUsers || 0),
    premiumUsersChange24h: Number(d.premiumUsersChange24h || 0),
    ambassadorUsers: Number(d.ambassadorUsers || 0),
    ambassadorUsersChange24h: Number(d.ambassadorUsersChange24h || 0),
    premiumSubscriptions24h: Number(d.premiumSubscriptions24h || 0),
    ambassadorSubscriptions24h: Number(d.ambassadorSubscriptions24h || 0),
    upgrades24h: Number(d.upgrades24h || 0),
    unsubscribes24h: Number(d.unsubscribes24h || 0),
    paidUsers: Number(d.paidUsers || 0),
    totalTransactions: Number(d.totalTransactions || 0),
    locked: {
      premium: lockedPremium,
      ambassador: lockedAmbassador,
      total: lockedTotal,
    },
    lockedUsdValue: {
      premium: lockedPremium * nproPriceUsd,
      ambassador: lockedAmbassador * nproPriceUsd,
      total: lockedTotal * nproPriceUsd,
    },
  };
}
