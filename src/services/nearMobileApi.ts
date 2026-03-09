// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NEAR Mobile API Service
// Fetch NEAR token price from NEAR Mobile API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const NEAR_MOBILE_API_BASE = 'https://near-mobile-production.aws.peersyst.tech';
const COINGECKO_BASE = 'https://api.coingecko.com';

interface NearMobilePriceData {
  id: string;
  usdPrice: string;
  usd24hChange: string;
}

export interface NearPriceResult {
  usd: number;
  change24h: number;
}

function parseNearMobilePrice(data: unknown): NearPriceResult {
  if (!Array.isArray(data)) {
    throw new Error('NEAR Mobile API returned invalid response format');
  }

  const nearData = (data as NearMobilePriceData[]).find((t) => t.id === 'near');

  if (!nearData) {
    throw new Error('NEAR token data not found in NEAR Mobile API response');
  }

  return {
    usd: parseFloat(nearData.usdPrice),
    change24h: parseFloat(nearData.usd24hChange),
  }
}

async function fetchNearPriceFromNearMobile(): Promise<NearPriceResult> {
  const url = `${NEAR_MOBILE_API_BASE}/api/market`;

  console.log('🪙 NEAR Mobile API request: /api/market');

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`NEAR Mobile API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return parseNearMobilePrice(data);
}

async function fetchNearPriceFromCoinGecko(): Promise<NearPriceResult> {
  const url = `${COINGECKO_BASE}/api/v3/simple/price?ids=near&vs_currencies=usd&include_24hr_change=true`;

  console.log('🪙 CoinGecko request: /api/v3/simple/price (near)');

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`CoinGecko error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    near?: {
      usd?: number;
      usd_24h_change?: number;
    };
  };

  const near = data.near;

  if (!near || typeof near.usd !== 'number') {
    throw new Error('NEAR token data not found in CoinGecko response');
  }

  return {
    usd: near.usd,
    change24h: typeof near.usd_24h_change === 'number' ? near.usd_24h_change : 0,
  };
}

/**
 * Fetch NEAR price from NEAR Mobile API
 */
export async function fetchNearPrice(): Promise<NearPriceResult> {
  try {
    return await fetchNearPriceFromNearMobile();
  } catch (error) {
    const mobileError = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ NEAR Mobile API unavailable, falling back to CoinGecko. Reason: ${mobileError}`);

    try {
      return await fetchNearPriceFromCoinGecko();
    } catch (fallbackError) {
      const coinGeckoError = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`NEAR Mobile API failed (${mobileError}); fallback failed (${coinGeckoError})`);
    }
  };
}
