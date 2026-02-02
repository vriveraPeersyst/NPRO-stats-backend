import { getNearRpcManager } from './nearRpcManager.js';
import { CONSTANTS } from '../config/env.js';
import { formatTokenAmount, calculateUsdValue } from '../utils/format.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NEAR FT Balance Service
// Fetch FT balances and validator stats via NEAR RPC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ViewFunctionResult {
  result: number[];
  logs: string[];
  block_height: number;
  block_hash: string;
}

/**
 * Decode view function result from bytes to string
 */
function decodeResult(result: number[]): string {
  return String.fromCharCode(...result);
}

/**
 * Call a view function on a NEAR contract
 */
async function viewFunction(
  contractId: string,
  methodName: string,
  args: Record<string, unknown> = {}
): Promise<string> {
  const rpcManager = getNearRpcManager();

  return rpcManager.makeRequest(async (provider) => {
    const argsBase64 = Buffer.from(JSON.stringify(args)).toString('base64');

    const rawResult = await provider.query({
      request_type: 'call_function',
      finality: 'final',
      account_id: contractId,
      method_name: methodName,
      args_base64: argsBase64,
    });

    const result = rawResult as unknown as ViewFunctionResult;
    return decodeResult(result.result);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FT Balance Functions
// ─────────────────────────────────────────────────────────────────────────────

export interface FtBalanceResult {
  raw: string;
  formatted: string;
  number: number;
  usdValue: number;
}

/**
 * Get FT balance for an account
 */
export async function getFtBalance(
  tokenContract: string,
  accountId: string,
  priceUsd: number = 0
): Promise<FtBalanceResult> {
  try {
    const rawResult = await viewFunction(tokenContract, 'ft_balance_of', {
      account_id: accountId,
    });

    // Result is a quoted string like "12345..."
    const raw = rawResult.replace(/"/g, '');

    return {
      raw,
      formatted: formatTokenAmount(raw),
      number: parseFloat(formatTokenAmount(raw)),
      usdValue: calculateUsdValue(raw, priceUsd),
    };
  } catch (error) {
    console.warn(`⚠️ Failed to get FT balance for ${accountId}: ${error}`);
    return {
      raw: '0',
      formatted: '0',
      number: 0,
      usdValue: 0,
    };
  }
}

/**
 * Get NPRO balances for all tracked accounts
 */
export async function getTrackedAccountBalances(
  priceUsd: number
): Promise<Record<string, FtBalanceResult>> {
  const results: Record<string, FtBalanceResult> = {};

  for (const [name, accountId] of Object.entries(CONSTANTS.TRACKED_ACCOUNTS)) {
    results[name] = await getFtBalance(CONSTANTS.NPRO_CONTRACT, accountId, priceUsd);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validator Stats Functions
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidatorStats {
  /** Actively staked NEAR earning rewards */
  stakedBalance: {
    raw: string;
    formatted: string;
    number: number;
  };
  /** Unstaked NEAR (pending cooldown + ready to withdraw) - from pool's liquid balance */
  unstakedBalance: {
    raw: string;
    formatted: string;
    number: number;
  };
  /** Total delegated NEAR (staked + unstaked) */
  totalBalance: {
    raw: string;
    formatted: string;
    number: number;
  };
  /** Number of delegators in the pool */
  delegatorCount: number;
  rpcUrlUsed: string;
}

/**
 * Get validator staking pool stats
 * 
 * - stakedBalance: from get_total_staked_balance() - actively earning rewards
 * - unstakedBalance: from account.amount (pool's liquid NEAR) - includes unstaked tokens
 * - totalBalance: staked + unstaked
 */
export async function getValidatorStats(): Promise<ValidatorStats> {
  const rpcManager = getNearRpcManager();

  try {
    // Get total staked balance (actively staking)
    const stakedResult = await viewFunction(
      CONSTANTS.VALIDATOR_POOL,
      'get_total_staked_balance',
      {}
    );
    const stakedRaw = stakedResult.replace(/"/g, '');

    // Get number of delegators
    const delegatorCountResult = await viewFunction(
      CONSTANTS.VALIDATOR_POOL,
      'get_number_of_accounts',
      {}
    );
    const delegatorCount = parseInt(delegatorCountResult.replace(/"/g, ''), 10) || 0;

    // Get account state - amount contains liquid NEAR (unstaked balances)
    interface AccountView {
      amount: string;
      locked: string;
      code_hash: string;
      storage_usage: number;
      storage_paid_at: number;
      block_height: number;
      block_hash: string;
    }

    const accountView = await rpcManager.makeRequest(async (provider) => {
      const rawResult = await provider.query({
        request_type: 'view_account',
        finality: 'final',
        account_id: CONSTANTS.VALIDATOR_POOL,
      });
      return rawResult as unknown as AccountView;
    });

    // unstaked = account.amount (pool's liquid balance containing unstaked tokens)
    // This includes both tokens in cooldown and ready to withdraw
    const stakedAmount = BigInt(stakedRaw);
    const unstakedAmount = BigInt(accountView.amount);
    const unstakedRaw = unstakedAmount.toString();
    const totalAmount = stakedAmount + unstakedAmount;
    const totalRaw = totalAmount.toString();

    const stakedFormatted = formatTokenAmount(stakedRaw);
    const unstakedFormatted = formatTokenAmount(unstakedRaw);

    return {
      stakedBalance: {
        raw: stakedRaw,
        formatted: stakedFormatted,
        number: parseFloat(stakedFormatted),
      },
      unstakedBalance: {
        raw: unstakedRaw,
        formatted: unstakedFormatted,
        number: parseFloat(unstakedFormatted),
      },
      totalBalance: {
        raw: totalRaw,
        formatted: formatTokenAmount(totalRaw),
        number: parseFloat(formatTokenAmount(totalRaw)),
      },
      delegatorCount,
      rpcUrlUsed: rpcManager.getCurrentUrl(),
    };
  } catch (error) {
    console.error('❌ Failed to get validator stats:', error);
    throw error;
  }
}
