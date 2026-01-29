// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NEAR Mobile API Service
// Fetch NEAR token price from NEAR Mobile API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const NEAR_MOBILE_API_BASE = 'https://near-mobile-production.aws.peersyst.tech';

interface NearMobilePriceData {
  id: string;
  usdPrice: string;
  usd24hChange: string;
}

export interface NearPriceResult {
  usd: number;
  change24h: number;
}

/**
 * Fetch NEAR price from NEAR Mobile API
 */
export async function fetchNearPrice(): Promise<NearPriceResult> {
  const url = `${NEAR_MOBILE_API_BASE}/api/prices`;

  console.log(`🪙 NEAR Mobile API request: /api/prices`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`NEAR Mobile API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as NearMobilePriceData[];
  const nearData = data.find((t) => t.id === 'near');

  if (!nearData) {
    throw new Error('NEAR token data not found in NEAR Mobile API response');
  }

  return {
    usd: parseFloat(nearData.usdPrice),
    change24h: parseFloat(nearData.usd24hChange),
  };
}
