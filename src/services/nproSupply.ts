// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NPRO Supply Service
// Fetch NPRO circulating supply from CMC/CG API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const NPRO_SUPPLY_API = 'https://cmc-cg-api.vercel.app/api/v1/circulating-supply';

/**
 * Fetch NPRO circulating supply from the CMC/CG API
 */
export async function fetchNproCirculatingSupply(): Promise<number> {
  console.log(`🪙 Fetching NPRO circulating supply from CMC/CG API...`);

  const response = await fetch(NPRO_SUPPLY_API, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`NPRO Supply API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.text();
  const circulatingSupply = parseFloat(data);

  if (isNaN(circulatingSupply)) {
    throw new Error(`Invalid circulating supply value: ${data}`);
  }

  console.log(`✅ NPRO circulating supply: ${circulatingSupply.toLocaleString()}`);
  return circulatingSupply;
}
