import { prisma } from '../db/prisma.js';
import { CONSTANTS } from '../config/env.js';
import { getNearBlocksClient } from '../services/nearblocksClient.js';
import { writeSnapshot, getDelta24h, cleanupOldSnapshots } from '../utils/snapshots.js';
import { runPremiumIndexer, getPremiumStats, snapshotPremiumStats } from '../indexers/premiumIndexer.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Slow Sync
// Runs every 60 minutes
// - NearBlocks holders/transfers counts + snapshot
// - Premium indexer incremental run
// - Cleanup old snapshots
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface SlowSyncResult {
  success: boolean;
  duration: number;
  errors: string[];
  metrics: {
    nearblocks: boolean;
    premium: boolean;
    cleanup: boolean;
  };
  premiumIndexer?: {
    pagesProcessed: number;
    eventsProcessed: number;
  };
  cleanedSnapshots?: number;
}

export async function runSlowSync(): Promise<SlowSyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const metrics = {
    nearblocks: false,
    premium: false,
    cleanup: false,
  };
  let premiumIndexerResult: { pagesProcessed: number; eventsProcessed: number } | undefined;
  let cleanedSnapshots: number | undefined;

  console.log('🚀 Starting slow sync...');

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Fetch NearBlocks Stats (holders count, transfers count)
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    console.log('📊 Fetching NearBlocks stats...');
    const client = getNearBlocksClient();

    // Get holder count
    const holdersCount = await client.getHolderCount(CONSTANTS.NPRO_CONTRACT);
    console.log(`   Holders: ${holdersCount}`);

    // Get transfer count
    const transfersCount = await client.getTransferCount(CONSTANTS.NPRO_CONTRACT);
    console.log(`   Transfers: ${transfersCount}`);

    // Calculate 24h deltas
    const holdersDelta24h = await getDelta24h(CONSTANTS.SNAPSHOT_KEYS.HOLDERS_COUNT, holdersCount);
    const transfersDelta24h = await getDelta24h(
      CONSTANTS.SNAPSHOT_KEYS.TRANSFERS_COUNT,
      transfersCount
    );

    // Store current values
    await prisma.metricCurrent.upsert({
      where: { key: CONSTANTS.METRIC_KEYS.NEARBLOCKS_STATS },
      update: {
        value: {
          holders: {
            count: holdersCount,
            delta24h: holdersDelta24h,
          },
          transfers: {
            count: transfersCount,
            delta24h: transfersDelta24h,
          },
        },
      },
      create: {
        key: CONSTANTS.METRIC_KEYS.NEARBLOCKS_STATS,
        value: {
          holders: {
            count: holdersCount,
            delta24h: holdersDelta24h,
          },
          transfers: {
            count: transfersCount,
            delta24h: transfersDelta24h,
          },
        },
      },
    });

    // Write snapshots for future delta calculations
    await writeSnapshot(CONSTANTS.SNAPSHOT_KEYS.HOLDERS_COUNT, holdersCount);
    await writeSnapshot(CONSTANTS.SNAPSHOT_KEYS.TRANSFERS_COUNT, transfersCount);

    metrics.nearblocks = true;
    console.log(
      `✅ NearBlocks stats updated. Holders: ${holdersCount} (Δ${holdersDelta24h}), Transfers: ${transfersCount} (Δ${transfersDelta24h})`
    );
  } catch (error) {
    const message = `NearBlocks error: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`❌ ${message}`);
    errors.push(message);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Run Premium Indexer
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    console.log('📊 Running premium indexer...');
    const result = await runPremiumIndexer();
    premiumIndexerResult = {
      pagesProcessed: result.pagesProcessed,
      eventsProcessed: result.eventsProcessed,
    };

    // Write premium stats snapshots
    await snapshotPremiumStats();

    // Get and store premium stats
    const premiumStats = await getPremiumStats();

    await prisma.metricCurrent.upsert({
      where: { key: CONSTANTS.METRIC_KEYS.PREMIUM_STATS },
      update: {
        value: premiumStats as any,
      },
      create: {
        key: CONSTANTS.METRIC_KEYS.PREMIUM_STATS,
        value: premiumStats as any,
      },
    });

    metrics.premium = true;
    console.log(
      `✅ Premium indexer completed. Pages: ${result.pagesProcessed}, Events: ${result.eventsProcessed}`
    );
    console.log(
      `   Premium users: ${premiumStats.premiumUsers}, Ambassador users: ${premiumStats.ambassadorUsers}`
    );
  } catch (error) {
    const message = `Premium indexer error: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`❌ ${message}`);
    errors.push(message);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Cleanup Old Snapshots
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    console.log('📊 Cleaning up old snapshots...');
    cleanedSnapshots = await cleanupOldSnapshots(7); // Keep 7 days
    metrics.cleanup = true;
    console.log(`✅ Cleaned up ${cleanedSnapshots} old snapshots`);
  } catch (error) {
    const message = `Cleanup error: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`❌ ${message}`);
    errors.push(message);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Update sync state
  // ─────────────────────────────────────────────────────────────────────────────
  const success = errors.length === 0;
  const duration = Date.now() - startTime;

  await prisma.syncState.upsert({
    where: { type: 'slow' },
    update: {
      lastRunAt: new Date(),
      status: success ? 'success' : 'error',
      error: success ? null : errors.join('; '),
    },
    create: {
      type: 'slow',
      lastRunAt: new Date(),
      status: success ? 'success' : 'error',
      error: success ? null : errors.join('; '),
    },
  });

  // Also update premium sync state
  await prisma.syncState.upsert({
    where: { type: 'premium' },
    update: {
      lastRunAt: new Date(),
      status: metrics.premium ? 'success' : 'error',
      error: metrics.premium ? null : 'Premium indexer failed',
    },
    create: {
      type: 'premium',
      lastRunAt: new Date(),
      status: metrics.premium ? 'success' : 'error',
      error: metrics.premium ? null : 'Premium indexer failed',
    },
  });

  console.log(
    `🏁 Slow sync completed in ${duration}ms. Success: ${success}, Errors: ${errors.length}`
  );

  return {
    success,
    duration,
    errors,
    metrics,
    premiumIndexer: premiumIndexerResult,
    cleanedSnapshots,
  };
}
