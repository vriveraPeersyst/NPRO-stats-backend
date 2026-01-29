import { getEnv } from '../config/env.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CoinGecko API Service
// Fetch token prices and market data
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface TokenPriceData {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d_in_currency?: number;
  price_change_percentage_30d_in_currency?: number;
  market_cap: number;
  fully_diluted_valuation?: number;
  circulating_supply?: number;
  total_supply?: number;
}

export interface PriceResult {
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
}

async function fetchFromCoinGecko<T>(path: string): Promise<T> {
  const env = getEnv();
  const url = new URL(path, env.COINGECKO_BASE);

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  // Add API key if available (for pro tier)
  if (env.COINGECKO_API_KEY) {
    headers['x-cg-pro-api-key'] = env.COINGECKO_API_KEY;
  }

  console.log(`🪙 CoinGecko request: ${url.pathname}`);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
  });

  if (response.status === 429) {
    throw new Error('CoinGecko rate limit exceeded');
  }

  if (!response.ok) {
    throw new Error(`CoinGecko error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Fetch prices for NPRO and NEAR from CoinGecko
 */
export async function fetchTokenPrices(): Promise<PriceResult> {
  // Using the /coins/markets endpoint which provides all needed data
  const data = await fetchFromCoinGecko<TokenPriceData[]>(
    '/coins/markets?vs_currency=usd&ids=npro,near&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h,7d,30d'
  );

  const nproData = data.find((t) => t.id === 'npro');
  const nearData = data.find((t) => t.id === 'near');

  if (!nproData) {
    throw new Error('NPRO token data not found in CoinGecko response');
  }

  if (!nearData) {
    throw new Error('NEAR token data not found in CoinGecko response');
  }

  const nproUsd = nproData.current_price || 0;
  const nearUsd = nearData.current_price || 0;
  const nproInNear = nearUsd > 0 ? nproUsd / nearUsd : 0;

  // Calculate NPRO/NEAR 24h change
  const nproYesterday = nproUsd / (1 + (nproData.price_change_percentage_24h || 0) / 100);
  const nearYesterday = nearUsd / (1 + (nearData.price_change_percentage_24h || 0) / 100);
  const nproInNearYesterday = nearYesterday > 0 ? nproYesterday / nearYesterday : 0;
  const nproInNearChange24h =
    nproInNearYesterday > 0 ? ((nproInNear - nproInNearYesterday) / nproInNearYesterday) * 100 : 0;

  return {
    npro: {
      usd: nproUsd,
      change24h: nproData.price_change_percentage_24h || 0,
      change7d: nproData.price_change_percentage_7d_in_currency || 0,
      change30d: nproData.price_change_percentage_30d_in_currency || 0,
      marketCap: nproData.market_cap || 0,
      fdv: nproData.fully_diluted_valuation || nproUsd * 10_000_000,
      circulatingSupply: nproData.circulating_supply || 0,
    },
    near: {
      usd: nearUsd,
      change24h: nearData.price_change_percentage_24h || 0,
      change7d: nearData.price_change_percentage_7d_in_currency || 0,
      change30d: nearData.price_change_percentage_30d_in_currency || 0,
    },
    nproInNear,
    nproInNearChange24h,
  };
}
