import { getEnv } from '../config/env.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NearBlocks API Client
// Rate-limited client with key rotation, throttling, and retry logic
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ApiKeyState {
  key: string;
  failures: number;
  last429At?: number;
  cooldownUntil?: number;
}

class NearBlocksClient {
  private keys: ApiKeyState[] = [];
  private currentKeyIndex: number = 0;
  private lastRequestTime: number = 0;
  private requestMutex: Promise<void> = Promise.resolve();

  private readonly baseUrl: string;
  private readonly headerName: string;
  private readonly headerPrefix: string;
  private readonly pollInterval: number;
  private readonly keyCooldown: number;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly pageLimit: number;
  private readonly maxPagesPerRun: number;

  constructor() {
    const env = getEnv();

    this.baseUrl = env.NEARBLOCKS_BASE;
    this.headerName = env.NEARBLOCKS_API_HEADER;
    this.headerPrefix = env.NEARBLOCKS_API_PREFIX;
    this.pollInterval = env.POLL_INTERVAL_MS;
    this.keyCooldown = env.NEARBLOCKS_KEY_COOLDOWN_MS;
    this.timeout = env.NEARBLOCKS_TIMEOUT_MS;
    this.maxRetries = env.NEARBLOCKS_MAX_RETRIES;
    this.pageLimit = env.PAGE_LIMIT;
    this.maxPagesPerRun = env.NEARBLOCKS_MAX_PAGES_PER_RUN;

    // Initialize API keys
    this.keys = env.NEARBLOCKS_API_KEYS.map((key) => ({
      key,
      failures: 0,
    }));

    if (this.keys.length === 0) {
      console.warn('⚠️ No NearBlocks API keys configured. Requests may fail.');
    }

    console.log(
      `📊 NearBlocks client initialized with ${this.keys.length} API keys, poll interval: ${this.pollInterval}ms`
    );
  }

  /**
   * Get the current available API key
   */
  private getCurrentKey(): ApiKeyState | null {
    const now = Date.now();

    // Clear expired cooldowns
    for (const key of this.keys) {
      if (key.cooldownUntil && now >= key.cooldownUntil) {
        key.cooldownUntil = undefined;
        key.failures = 0;
        console.log(`✅ NearBlocks API key ${key.key.slice(0, 8)}... cooldown expired`);
      }
    }

    // Find available keys
    const availableKeys = this.keys.filter((k) => !k.cooldownUntil || now >= k.cooldownUntil);

    if (availableKeys.length === 0) {
      // All keys cooling down, use the one that will be available soonest
      const sortedByExpiry = [...this.keys].sort(
        (a, b) => (a.cooldownUntil || 0) - (b.cooldownUntil || 0)
      );
      return sortedByExpiry[0] || null;
    }

    // Cycle through available keys
    if (this.currentKeyIndex >= availableKeys.length) {
      this.currentKeyIndex = 0;
    }

    return availableKeys[this.currentKeyIndex];
  }

  /**
   * Mark current key as rate limited
   */
  private handleRateLimit(key: ApiKeyState): void {
    key.last429At = Date.now();
    key.cooldownUntil = Date.now() + this.keyCooldown;
    key.failures++;

    console.warn(
      `🚫 NearBlocks API key ${key.key.slice(0, 8)}... rate limited, cooling down for ${
        this.keyCooldown / 1000
      }s`
    );

    // Rotate to next key
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.keys.length;
  }

  /**
   * Enforce global pacing between requests
   */
  private async waitForPacing(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.pollInterval) {
      const waitTime = this.pollInterval - timeSinceLastRequest;
      console.log(`⏳ NearBlocks pacing: waiting ${waitTime}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  /**
   * Make a request with rate limiting, key rotation, and retries
   */
  async request<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    // Use mutex to ensure only one request at a time
    return new Promise((resolve, reject) => {
      this.requestMutex = this.requestMutex.then(async () => {
        try {
          const result = await this.executeRequest<T>(path, params);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private async executeRequest<T>(
    path: string,
    params?: Record<string, string | number>
  ): Promise<T> {
    await this.waitForPacing();

    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const currentKey = this.getCurrentKey();

      const headers: Record<string, string> = {
        Accept: 'application/json',
      };

      if (currentKey) {
        headers[this.headerName] = `${this.headerPrefix}${currentKey.key}`;
      }

      try {
        console.log(`📊 NearBlocks request: ${url.pathname} (attempt ${attempt + 1})`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url.toString(), {
          method: 'GET',
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        this.lastRequestTime = Date.now();

        if (response.status === 429) {
          if (currentKey) {
            this.handleRateLimit(currentKey);
          }
          await this.waitForPacing();
          continue;
        }

        if (response.status >= 500) {
          throw new Error(`Server error: ${response.status}`);
        }

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as T;
        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const isTimeout = lastError.name === 'AbortError' || lastError.message.includes('timeout');
        const isNetworkError =
          lastError.message.includes('ECONNRESET') ||
          lastError.message.includes('ECONNREFUSED') ||
          lastError.message.includes('fetch failed');

        if (isTimeout || isNetworkError) {
          console.warn(`⚠️ NearBlocks request failed (${isTimeout ? 'timeout' : 'network'}), retrying...`);
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt), 5000))
          );
          continue;
        }

        // For other errors, don't retry
        throw lastError;
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Get page limit for pagination
   */
  getPageLimit(): number {
    return this.pageLimit;
  }

  /**
   * Get max pages per run
   */
  getMaxPagesPerRun(): number {
    return this.maxPagesPerRun;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Convenience Methods for NPRO Dashboard
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get holder count for a token
   */
  async getHolderCount(contract: string): Promise<number> {
    interface HolderCountResponse {
      holders: Array<{ count: string }>;
    }

    const data = await this.request<HolderCountResponse>(
      `/v1/fts/${contract}/holders/count`
    );

    return parseInt(data.holders[0]?.count || '0', 10);
  }

  /**
   * Get transfer count for a token
   */
  async getTransferCount(contract: string): Promise<number> {
    interface TransferCountResponse {
      txns: Array<{ count: string }>;
    }

    const data = await this.request<TransferCountResponse>(
      `/v1/fts/${contract}/txns/count`
    );

    return parseInt(data.txns[0]?.count || '0', 10);
  }

  /**
   * Get FT transactions for an account with pagination
   */
  async getAccountFtTxns(
    account: string,
    cursor?: string,
    limit?: number
  ): Promise<{
    cursor: string | null;
    txns: Array<{
      event_index: string;
      affected_account_id: string;
      involved_account_id: string;
      delta_amount: string;
      cause: string;
      transaction_hash: string;
      block_timestamp: string;
      block: { block_height: number };
      outcomes: { status: boolean };
      ft: {
        contract: string;
        name: string;
        symbol: string;
        decimals: number;
      };
    }>;
  }> {
    interface FtTxnsResponse {
      cursor?: string;
      txns: Array<{
        event_index: string;
        affected_account_id: string;
        involved_account_id: string;
        delta_amount: string;
        cause: string;
        transaction_hash: string;
        block_timestamp: string;
        block: { block_height: number };
        outcomes: { status: boolean };
        ft: {
          contract: string;
          name: string;
          symbol: string;
          decimals: number;
        };
      }>;
    }

    const params: Record<string, string | number> = {};
    if (cursor) params.cursor = cursor;
    if (limit) params.limit = limit;

    const data = await this.request<FtTxnsResponse>(
      `/v1/account/${account}/ft-txns`,
      params
    );

    return {
      cursor: data.cursor || null,
      txns: data.txns || [],
    };
  }
}

// Singleton instance - lazy initialization
let nearBlocksClientInstance: NearBlocksClient | null = null;

export function getNearBlocksClient(): NearBlocksClient {
  if (!nearBlocksClientInstance) {
    nearBlocksClientInstance = new NearBlocksClient();
  }
  return nearBlocksClientInstance;
}

export type { NearBlocksClient };
