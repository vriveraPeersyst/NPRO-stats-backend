import { JsonRpcProvider } from 'near-api-js';
import { getEnv } from '../config/env.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NEAR RPC Manager
// Server-side RPC failover manager with blacklisting
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface RpcEndpoint {
  url: string;
  failures: number;
  lastFailure?: number;
  isBlacklisted: boolean;
}

const MAX_FAILURES = 3;
const BLACKLIST_DURATION_MS = 5 * 60 * 1000; // 5 minutes

class NearRpcManager {
  private endpoints: RpcEndpoint[] = [];
  private currentIndex: number = 0;
  private provider: JsonRpcProvider | null = null;

  constructor() {
    this.initializeEndpoints();
    this.setupProvider();
  }

  private initializeEndpoints(): void {
    const env = getEnv();
    const urls = env.NEAR_RPC_URLS;

    if (urls.length === 0) {
      throw new Error('No NEAR RPC URLs configured');
    }

    this.endpoints = urls.map((url) => ({
      url,
      failures: 0,
      isBlacklisted: false,
    }));

    console.log(
      `🔗 NEAR RPC Manager initialized with ${this.endpoints.length} endpoints:`,
      this.endpoints.map((ep) => ep.url)
    );
  }

  private setupProvider(): void {
    const currentEndpoint = this.getCurrentEndpoint();
    if (currentEndpoint) {
      console.log(`🌐 Setting up NEAR RPC provider: ${currentEndpoint.url}`);
      this.provider = new JsonRpcProvider({ url: currentEndpoint.url });
    } else {
      console.warn('⚠️ No NEAR RPC endpoint available');
    }
  }

  private getCurrentEndpoint(): RpcEndpoint | null {
    this.clearExpiredBlacklists();

    const availableEndpoints = this.endpoints.filter((ep) => !ep.isBlacklisted);

    if (availableEndpoints.length === 0) {
      console.warn('⚠️ All NEAR RPC endpoints are blacklisted, resetting...');
      this.resetAllEndpoints();
      return this.endpoints[0];
    }

    if (this.currentIndex >= availableEndpoints.length) {
      this.currentIndex = 0;
    }

    return availableEndpoints[this.currentIndex];
  }

  private clearExpiredBlacklists(): void {
    const now = Date.now();
    for (const endpoint of this.endpoints) {
      if (endpoint.isBlacklisted && endpoint.lastFailure) {
        if (now - endpoint.lastFailure > BLACKLIST_DURATION_MS) {
          endpoint.isBlacklisted = false;
          endpoint.failures = 0;
          console.log(`✅ NEAR RPC endpoint unblacklisted: ${endpoint.url}`);
        }
      }
    }
  }

  private resetAllEndpoints(): void {
    for (const endpoint of this.endpoints) {
      endpoint.failures = 0;
      endpoint.isBlacklisted = false;
      endpoint.lastFailure = undefined;
    }
  }

  private switchToNextEndpoint(): void {
    const availableEndpoints = this.endpoints.filter((ep) => !ep.isBlacklisted);
    if (availableEndpoints.length > 1) {
      this.currentIndex = (this.currentIndex + 1) % availableEndpoints.length;
    }
    this.setupProvider();
    console.log(`🔄 Switched to NEAR RPC endpoint: ${this.getCurrentEndpoint()?.url}`);
  }

  private handleFailure(error: unknown): boolean {
    const currentEndpoint = this.getCurrentEndpoint();
    if (!currentEndpoint) return false;

    currentEndpoint.failures += 1;
    currentEndpoint.lastFailure = Date.now();

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Detect rate limiting
    const isRateLimit =
      errorMessage.includes('rate') ||
      errorMessage.includes('429') ||
      errorMessage.includes('Too many requests') ||
      errorMessage.includes('throttle') ||
      errorMessage.includes('exceeded');

    // Detect connection errors
    const isConnectionError =
      errorMessage.includes('ECONNRESET') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('ETIMEDOUT') ||
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('network') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('Failed to fetch');

    // Detect server errors
    const isServerError =
      errorMessage.includes('500') ||
      errorMessage.includes('502') ||
      errorMessage.includes('503') ||
      errorMessage.includes('504');

    const shouldSwitchImmediately = isRateLimit || isConnectionError || isServerError;

    if (shouldSwitchImmediately || currentEndpoint.failures >= MAX_FAILURES) {
      currentEndpoint.isBlacklisted = true;
      console.warn(
        `🚫 Blacklisted NEAR RPC ${currentEndpoint.url} (${
          isRateLimit ? 'rate limit' : isConnectionError ? 'connection error' : 'failures'
        })`
      );
      this.switchToNextEndpoint();
      return true;
    }

    console.warn(
      `⚠️ NEAR RPC failure on ${currentEndpoint.url} (attempt ${currentEndpoint.failures})`
    );
    this.switchToNextEndpoint();
    return true;
  }

  /**
   * Execute a request with automatic failover
   */
  async makeRequest<T>(requestFn: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
    if (!this.provider) {
      this.setupProvider();
    }

    if (!this.provider) {
      throw new Error('No NEAR RPC provider available');
    }

    const maxRetries = Math.min(this.endpoints.length, 5);
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const currentProvider = this.provider;
      if (!currentProvider) {
        throw new Error('No NEAR RPC provider available after switch');
      }

      try {
        console.log(`📡 NEAR RPC request attempt ${attempt + 1} using ${this.getCurrentUrl()}`);
        const result = await requestFn(currentProvider);

        // Reset failure count on success
        const currentEndpoint = this.getCurrentEndpoint();
        if (currentEndpoint && currentEndpoint.failures > 0) {
          currentEndpoint.failures = 0;
        }

        return result;
      } catch (error) {
        console.warn(`❌ NEAR RPC request failed on attempt ${attempt + 1}:`, error);
        lastError = error;

        const switched = this.handleFailure(error);

        if (attempt < maxRetries - 1) {
          const waitTime = switched ? 500 : Math.min(1000 * Math.pow(2, attempt), 5000);
          console.log(`⏳ Waiting ${waitTime}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    const errorMessage = lastError instanceof Error ? lastError.message : 'Unknown RPC error';
    console.error(`💥 All ${maxRetries} NEAR RPC attempts failed. Last error: ${errorMessage}`);
    throw lastError || new Error('All NEAR RPC endpoints failed');
  }

  /**
   * Get the current provider instance
   */
  getProvider(): JsonRpcProvider {
    if (!this.provider) {
      throw new Error('No NEAR RPC provider available');
    }
    return this.provider;
  }

  /**
   * Get the current RPC URL
   */
  getCurrentUrl(): string {
    return this.getCurrentEndpoint()?.url || 'unknown';
  }

  /**
   * Get status of all endpoints
   */
  getStatus(): {
    currentUrl: string;
    endpoints: Array<{
      url: string;
      failures: number;
      isBlacklisted: boolean;
      lastFailure?: number;
    }>;
  } {
    return {
      currentUrl: this.getCurrentUrl(),
      endpoints: this.endpoints.map((ep) => ({
        url: ep.url,
        failures: ep.failures,
        isBlacklisted: ep.isBlacklisted,
        lastFailure: ep.lastFailure,
      })),
    };
  }
}

// Singleton instance - lazy initialization
let rpcManagerInstance: NearRpcManager | null = null;

export function getNearRpcManager(): NearRpcManager {
  if (!rpcManagerInstance) {
    rpcManagerInstance = new NearRpcManager();
  }
  return rpcManagerInstance;
}

export type { NearRpcManager };
