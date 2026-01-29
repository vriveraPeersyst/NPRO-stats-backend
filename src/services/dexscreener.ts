import { getEnv } from '../config/env.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DexScreener API Service
// Fetch liquidity and trading data for NPRO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    h6?: number;
    h24?: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
}

export interface LiquidityResult {
  rhea: {
    tvlUsd: number;
    baseNpro: number;
    quoteNear: number;
    priceUsd: number;
    priceNative: number;
    priceChange24hPct: number;
    volume24h: number;
    buys24h: number;
    sells24h: number;
    totalTxns24h: number;
    pairUrl: string;
    marketCap: number;
    fdv: number;
  };
  intentsBalance?: {
    raw: string;
    formatted: number;
    usdValue: number;
  };
}

/**
 * Fetch liquidity data from DexScreener
 */
export async function fetchLiquidityData(): Promise<LiquidityResult> {
  const env = getEnv();
  const url = `${env.DEXSCREENER_BASE}/token-pairs/v1/near/npro.nearmobile.near`;

  console.log(`📈 DexScreener request: token pairs for NPRO`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (response.status === 429) {
    throw new Error('DexScreener rate limit exceeded');
  }

  if (!response.ok) {
    throw new Error(`DexScreener error: ${response.status} ${response.statusText}`);
  }

  const pairs = (await response.json()) as DexScreenerPair[];

  // Find Rhea Finance pair (primary liquidity source)
  const rheaPair = pairs.find((p) => p.dexId === 'rhea-finance');

  if (!rheaPair) {
    // If no Rhea pair, use the first available pair
    const firstPair = pairs[0];
    if (!firstPair) {
      throw new Error('No liquidity pairs found for NPRO');
    }

    return {
      rhea: {
        tvlUsd: firstPair.liquidity?.usd || 0,
        baseNpro: firstPair.liquidity?.base || 0,
        quoteNear: firstPair.liquidity?.quote || 0,
        priceUsd: parseFloat(firstPair.priceUsd) || 0,
        priceNative: parseFloat(firstPair.priceNative) || 0,
        priceChange24hPct: firstPair.priceChange?.h24 || 0,
        volume24h: firstPair.volume?.h24 || 0,
        buys24h: firstPair.txns?.h24?.buys || 0,
        sells24h: firstPair.txns?.h24?.sells || 0,
        totalTxns24h: (firstPair.txns?.h24?.buys || 0) + (firstPair.txns?.h24?.sells || 0),
        pairUrl: firstPair.url,
        marketCap: firstPair.marketCap || 0,
        fdv: firstPair.fdv || 0,
      },
    };
  }

  return {
    rhea: {
      tvlUsd: rheaPair.liquidity?.usd || 0,
      baseNpro: rheaPair.liquidity?.base || 0,
      quoteNear: rheaPair.liquidity?.quote || 0,
      priceUsd: parseFloat(rheaPair.priceUsd) || 0,
      priceNative: parseFloat(rheaPair.priceNative) || 0,
      priceChange24hPct: rheaPair.priceChange?.h24 || 0,
      volume24h: rheaPair.volume?.h24 || 0,
      buys24h: rheaPair.txns?.h24?.buys || 0,
      sells24h: rheaPair.txns?.h24?.sells || 0,
      totalTxns24h: (rheaPair.txns?.h24?.buys || 0) + (rheaPair.txns?.h24?.sells || 0),
      pairUrl: rheaPair.url,
      marketCap: rheaPair.marketCap || 0,
      fdv: rheaPair.fdv || 0,
    },
  };
}
