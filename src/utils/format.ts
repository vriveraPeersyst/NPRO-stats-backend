import { CONSTANTS } from '../config/env.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Formatting Utilities
// Safe handling of NPRO token amounts (24 decimals)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Format a raw token amount (24 decimals) to a human-readable decimal string
 */
export function formatTokenAmount(
  rawAmount: string | bigint,
  decimals: number = CONSTANTS.NPRO_DECIMALS
): string {
  const raw = typeof rawAmount === 'string' ? rawAmount : rawAmount.toString();

  if (raw === '0') {
    return '0';
  }

  // Handle negative amounts
  const isNegative = raw.startsWith('-');
  const absRaw = isNegative ? raw.slice(1) : raw;

  // Pad with zeros if needed
  const padded = absRaw.padStart(decimals + 1, '0');

  // Split into integer and decimal parts
  const integerPart = padded.slice(0, -decimals) || '0';
  const decimalPart = padded.slice(-decimals);

  // Remove trailing zeros from decimal part
  const trimmedDecimal = decimalPart.replace(/0+$/, '');

  const result = trimmedDecimal
    ? `${integerPart}.${trimmedDecimal}`
    : integerPart;

  return isNegative ? `-${result}` : result;
}

/**
 * Parse a human-readable amount to raw token amount (24 decimals)
 */
export function parseTokenAmount(
  amount: string | number,
  decimals: number = CONSTANTS.NPRO_DECIMALS
): string {
  const amountStr = typeof amount === 'number' ? amount.toString() : amount;

  const [integerPart, decimalPart = ''] = amountStr.split('.');

  // Pad or truncate decimal part to match decimals
  const paddedDecimal = decimalPart.padEnd(decimals, '0').slice(0, decimals);

  // Combine and remove leading zeros (but keep at least one digit)
  const raw = (integerPart + paddedDecimal).replace(/^0+/, '') || '0';

  return raw;
}

/**
 * Convert raw token amount to number (for display purposes only)
 * Warning: May lose precision for very large amounts
 */
export function rawToNumber(
  rawAmount: string | bigint,
  decimals: number = CONSTANTS.NPRO_DECIMALS
): number {
  const formatted = formatTokenAmount(rawAmount, decimals);
  return parseFloat(formatted);
}

/**
 * Calculate USD value from raw token amount and price
 */
export function calculateUsdValue(
  rawAmount: string | bigint,
  priceUsd: number,
  decimals: number = CONSTANTS.NPRO_DECIMALS
): number {
  const tokenAmount = rawToNumber(rawAmount, decimals);
  return tokenAmount * priceUsd;
}

/**
 * Format a number with comma separators
 */
export function formatNumber(num: number, decimals: number = 2): string {
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format USD value
 */
export function formatUsd(value: number): string {
  return `$${formatNumber(value, 2)}`;
}

/**
 * Safe BigInt comparison helper
 */
export function compareBigInt(a: string, b: string): number {
  const bigA = BigInt(a);
  const bigB = BigInt(b);
  if (bigA < bigB) return -1;
  if (bigA > bigB) return 1;
  return 0;
}

/**
 * Check if two raw amounts are equal (ignoring sign for specific amount)
 */
export function isRawAmountEqual(raw: string, target: string): boolean {
  // Handle potential negative values
  const absRaw = raw.startsWith('-') ? raw.slice(1) : raw;
  const absTarget = target.startsWith('-') ? target.slice(1) : target;
  return absRaw === absTarget;
}

/**
 * Classify premium delta type based on raw amount
 */
export function classifyPremiumDelta(deltaRaw: string): 
  'SUB_PREMIUM' | 'SUB_AMBASSADOR' | 'UPGRADE' | 'DOWNGRADE_PREMIUM' | 'DOWNGRADE_AMBASSADOR' | 'OTHER' {
  const isNegative = deltaRaw.startsWith('-');
  const absAmount = isNegative ? deltaRaw.slice(1) : deltaRaw;

  if (!isNegative) {
    // Positive amounts (deposits to premium account)
    if (absAmount === CONSTANTS.PREMIUM_AMOUNT) {
      return 'SUB_PREMIUM';
    }
    if (absAmount === CONSTANTS.AMBASSADOR_AMOUNT) {
      return 'SUB_AMBASSADOR';
    }
    if (absAmount === CONSTANTS.UPGRADE_AMOUNT) {
      return 'UPGRADE';
    }
  } else {
    // Negative amounts (withdrawals from premium account)
    if (absAmount === CONSTANTS.PREMIUM_AMOUNT) {
      return 'DOWNGRADE_PREMIUM';
    }
    if (absAmount === CONSTANTS.AMBASSADOR_AMOUNT) {
      return 'DOWNGRADE_AMBASSADOR';
    }
  }

  return 'OTHER';
}
