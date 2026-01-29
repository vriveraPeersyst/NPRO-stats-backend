import { validateEnvAtStartup, CONSTANTS } from '../config/env.js';
import { prisma, disconnectPrisma } from '../db/prisma.js';
import { withLock } from '../utils/locks.js';
import { runSlowSync } from '../sync/slowSync.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Slow Sync Cron Script
// Runs every 60 minutes via Railway cron
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔄 NPRO Stats - Slow Sync');
  console.log(`   Started at: ${new Date().toISOString()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Validate environment
    validateEnvAtStartup();

    // Connect to database
    await prisma.$connect();
    console.log('✅ Database connected');

    // Run with advisory lock to prevent overlapping runs
    const result = await withLock(CONSTANTS.LOCK_KEYS.SLOW_SYNC, async () => {
      return runSlowSync();
    });

    if (result === null) {
      // Lock was not acquired - another process is running
      console.log('ℹ️ Another slow sync is already running. Exiting.');
      await disconnectPrisma();
      process.exit(0);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Slow Sync Results:');
    console.log(`   Duration: ${result.duration}ms`);
    console.log(`   Success: ${result.success}`);
    console.log(`   NearBlocks stats: ${result.metrics.nearblocks ? '✅' : '❌'}`);
    console.log(`   Premium indexer: ${result.metrics.premium ? '✅' : '❌'}`);
    console.log(`   Cleanup: ${result.metrics.cleanup ? '✅' : '❌'}`);
    if (result.premiumIndexer) {
      console.log(`   Premium pages processed: ${result.premiumIndexer.pagesProcessed}`);
      console.log(`   Premium events processed: ${result.premiumIndexer.eventsProcessed}`);
    }
    if (result.cleanedSnapshots !== undefined) {
      console.log(`   Snapshots cleaned: ${result.cleanedSnapshots}`);
    }
    if (result.errors.length > 0) {
      console.log('   Errors:');
      result.errors.forEach((e) => console.log(`     - ${e}`));
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    await disconnectPrisma();
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('❌ Slow sync failed:', error);
    await disconnectPrisma();
    process.exit(1);
  }
}

main();
