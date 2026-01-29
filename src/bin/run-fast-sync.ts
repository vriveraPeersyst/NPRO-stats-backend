import { validateEnvAtStartup, CONSTANTS } from '../config/env.js';
import { prisma, disconnectPrisma } from '../db/prisma.js';
import { withLock } from '../utils/locks.js';
import { runFastSync } from '../sync/fastSync.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Fast Sync Cron Script
// Runs every 5 minutes via Railway cron
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔄 NPRO Stats - Fast Sync');
  console.log(`   Started at: ${new Date().toISOString()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Validate environment
    validateEnvAtStartup();

    // Connect to database
    await prisma.$connect();
    console.log('✅ Database connected');

    // Run with advisory lock to prevent overlapping runs
    const result = await withLock(CONSTANTS.LOCK_KEYS.FAST_SYNC, async () => {
      return runFastSync();
    });

    if (result === null) {
      // Lock was not acquired - another process is running
      console.log('ℹ️ Another fast sync is already running. Exiting.');
      await disconnectPrisma();
      process.exit(0);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Fast Sync Results:');
    console.log(`   Duration: ${result.duration}ms`);
    console.log(`   Success: ${result.success}`);
    console.log(`   Token prices: ${result.metrics.tokenPrices ? '✅' : '❌'}`);
    console.log(`   Liquidity: ${result.metrics.liquidity ? '✅' : '❌'}`);
    console.log(`   Validator: ${result.metrics.validator ? '✅' : '❌'}`);
    console.log(`   Account balances: ${result.metrics.accountBalances ? '✅' : '❌'}`);
    if (result.errors.length > 0) {
      console.log('   Errors:');
      result.errors.forEach((e) => console.log(`     - ${e}`));
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    await disconnectPrisma();
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('❌ Fast sync failed:', error);
    await disconnectPrisma();
    process.exit(1);
  }
}

main();
