import { z } from 'zod';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Environment Variable Schema
// Validates all required and optional environment variables at startup
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const envSchema = z.object({
  // Core
  PORT: z.string().default('8787').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DATABASE_URL: z.string().url(),
  SYNC_SECRET: z.string().min(16),

  // NEAR RPC
  NEAR_RPC_URLS: z.string().transform((val) => val.split(',').map((s: string) => s.trim()).filter(Boolean)),

  // NearBlocks
  NEARBLOCKS_BASE: z.string().url().default('https://api.nearblocks.io'),
  NEARBLOCKS_API_KEYS: z.string().transform((val) => val.split(',').map((s: string) => s.trim()).filter(Boolean)),
  NEARBLOCKS_API_HEADER: z.string().default('Authorization'),
  NEARBLOCKS_API_PREFIX: z.string().default('Bearer '),
  POLL_INTERVAL_MS: z.string().default('15000').transform(Number),
  PAGE_LIMIT: z.string().default('100').transform(Number),
  NEARBLOCKS_KEY_COOLDOWN_MS: z.string().default('180000').transform(Number),
  NEARBLOCKS_TIMEOUT_MS: z.string().default('10000').transform(Number),
  NEARBLOCKS_MAX_RETRIES: z.string().default('3').transform(Number),
  NEARBLOCKS_MAX_PAGES_PER_RUN: z.string().default('20').transform(Number),

  // DexScreener
  DEXSCREENER_BASE: z.string().url().default('https://api.dexscreener.com'),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

/**
 * Validates and returns environment variables.
 * Throws if validation fails.
 */
export function getEnv(): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Environment validation failed:');
    console.error(result.error.format());
    throw new Error('Invalid environment configuration');
  }

  cachedEnv = result.data;
  return cachedEnv;
}

/**
 * Validates environment at startup and logs configuration summary
 */
export function validateEnvAtStartup(): Env {
  const env = getEnv();

  console.log('✅ Environment validated successfully');
  console.log(`   NODE_ENV: ${env.NODE_ENV}`);
  console.log(`   PORT: ${env.PORT}`);
  console.log(`   NEAR RPC endpoints: ${env.NEAR_RPC_URLS.length}`);
  console.log(`   NearBlocks API keys: ${env.NEARBLOCKS_API_KEYS.length}`);

  return env;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const CONSTANTS = {
  // NPRO Token
  NPRO_CONTRACT: 'npro.nearmobile.near',
  NPRO_DECIMALS: 24,
  NPRO_TOTAL_SUPPLY: 10_000_000,

  // Validator
  VALIDATOR_POOL: 'npro.poolv1.near',

  // Accounts to track balances
  TRACKED_ACCOUNTS: {
    treasury: 'npro-treasury.sputnik-dao.near',
    team: 'npro-team.sputnik-dao.near',
    marketing: 'npro-marketing.sputnik-dao.near',
    staking: 'npro-staking.sputnik-dao.near',
    liquidity: 'npro-liquidity.sputnik-dao.near',
    distribution: 'distribution.nearmobile.near',
    premium: 'premium.nearmobile.near',
    intents: 'intents.near',
  },

  // Premium amounts (in raw units - 24 decimals)
  PREMIUM_AMOUNT: '250000000000000000000000000', // 250 NPRO
  AMBASSADOR_AMOUNT: '75000000000000000000000000', // 75 NPRO
  UPGRADE_AMOUNT: '175000000000000000000000000', // 175 NPRO

  // Premium amounts as numbers for calculations
  PREMIUM_TOKENS: 250,
  AMBASSADOR_TOKENS: 75,

  // Metric keys for storage
  METRIC_KEYS: {
    TOKEN_PRICES: 'token_prices',
    VALIDATOR_STATS: 'validator_stats',
    ACCOUNT_BALANCES: 'account_balances',
    NEARBLOCKS_STATS: 'nearblocks_stats',
    LIQUIDITY_STATS: 'liquidity_stats',
    PREMIUM_STATS: 'premium_stats',
  },

  // Snapshot keys
  SNAPSHOT_KEYS: {
    HOLDERS_COUNT: 'holders_count',
    TRANSFERS_COUNT: 'transfers_count',
    RHEA_TVL_USD: 'rhea_tvl_usd',
    RHEA_VOLUME_H24: 'rhea_volume_h24',
    PREMIUM_USER_COUNT: 'premium_user_count',
    AMBASSADOR_USER_COUNT: 'ambassador_user_count',
  },

  // Advisory lock keys
  LOCK_KEYS: {
    FAST_SYNC: 'npro_fast_sync',
    SLOW_SYNC: 'npro_slow_sync',
  },
} as const;
