// Define UserTier enum locally since it's not exported by @prisma/client
export enum UserTier {
  BASIC = 'BASIC',
  PREMIUM = 'PREMIUM',
  AMBASSADOR = 'AMBASSADOR',
}

// Define DeltaType enum locally since it's not exported by @prisma/client
export enum DeltaType {
  SUB_PREMIUM = 'SUB_PREMIUM',
  SUB_AMBASSADOR = 'SUB_AMBASSADOR',
  UPGRADE = 'UPGRADE',
  DOWNGRADE_PREMIUM = 'DOWNGRADE_PREMIUM',
  DOWNGRADE_AMBASSADOR = 'DOWNGRADE_AMBASSADOR',
  OTHER = 'OTHER',
}
import { prisma } from '../db/prisma.js';
import { getNearBlocksClient } from '../services/nearblocksClient.js';
import { CONSTANTS } from '../config/env.js';
import { classifyPremiumDelta } from '../utils/format.js';
import { writeSnapshot } from '../utils/snapshots.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Premium Indexer
// Indexes FT transactions for premium.nearmobile.near to track subscriptions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const PREMIUM_ACCOUNT = CONSTANTS.TRACKED_ACCOUNTS.premium;
const NPRO_CONTRACT = CONSTANTS.NPRO_CONTRACT;

export interface PremiumStats {
  premiumUsers: number;
  premiumUsersChange24h: number;
  ambassadorUsers: number;
  ambassadorUsersChange24h: number;
  premiumSubscriptions24h: number;
  ambassadorSubscriptions24h: number;
  upgrades24h: number;
  unsubscribes24h: number;
  paidUsers: number;
  totalTransactions: number;
  locked: {
    premium: number;
    ambassador: number;
    total: number;
  };
  lastIndexedAt: Date | null;
  cursor: string | null;
}

/**
 * Map string delta type to Prisma enum
 */
function toPrismaDeltaType(deltaType: string): DeltaType {
  switch (deltaType) {
    case 'SUB_PREMIUM':
      return DeltaType.SUB_PREMIUM;
    case 'SUB_AMBASSADOR':
      return DeltaType.SUB_AMBASSADOR;
    case 'UPGRADE':
      return DeltaType.UPGRADE;
    case 'DOWNGRADE_PREMIUM':
      return DeltaType.DOWNGRADE_PREMIUM;
    case 'DOWNGRADE_AMBASSADOR':
      return DeltaType.DOWNGRADE_AMBASSADOR;
    default:
      return DeltaType.OTHER;
  }
}

/**
 * Update user tier based on delta type
 */
function computeNewTier(currentTier: UserTier, deltaType: DeltaType): UserTier {
  switch (deltaType) {
    case DeltaType.SUB_PREMIUM:
      return UserTier.PREMIUM;
    case DeltaType.SUB_AMBASSADOR:
      return UserTier.AMBASSADOR;
    case DeltaType.UPGRADE:
      // Upgrade from AMBASSADOR to PREMIUM
      return UserTier.PREMIUM;
    case DeltaType.DOWNGRADE_PREMIUM:
      return UserTier.BASIC;
    case DeltaType.DOWNGRADE_AMBASSADOR:
      return UserTier.BASIC;
    default:
      return currentTier;
  }
}

/**
 * Process a single premium transaction
 */
async function processPremiumEvent(txn: {
  event_index: string;
  involved_account_id: string;
  delta_amount: string;
  transaction_hash: string;
  block_timestamp: string;
  ft: { contract: string };
}): Promise<boolean> {
  // Only process NPRO transactions
  if (txn.ft.contract !== NPRO_CONTRACT) {
    return false;
  }

  // Check if already processed (idempotency)
  const existing = await prisma.premiumEvent.findUnique({
    where: { eventIndex: txn.event_index },
  });

  if (existing) {
    return false; // Already processed
  }

  const deltaType = classifyPremiumDelta(txn.delta_amount);
  const prismaDeltaType = toPrismaDeltaType(deltaType);

  // Convert nanosecond timestamp to Date
  const blockTimestamp = new Date(parseInt(txn.block_timestamp) / 1_000_000);

  // Create the event record (only save events, don't update user tiers yet)
  await prisma.premiumEvent.create({
    data: {
      eventIndex: txn.event_index,
      accountId: txn.involved_account_id,
      deltaType: prismaDeltaType,
      deltaAmountRaw: txn.delta_amount,
      blockTimestamp,
      txHash: txn.transaction_hash,
    },
  });

  return true;
}

/**
 * Rebuild user tiers by replaying all events in chronological order
 * This ensures the correct final state regardless of fetch order
 */
async function rebuildUserTiersFromEvents(): Promise<{
  usersProcessed: number;
  tierCounts: { premium: number; ambassador: number; basic: number };
}> {
  console.log('🔄 Rebuilding user tiers from events in chronological order...');

  // Delete all existing users
  await prisma.premiumUser.deleteMany({});

  // Get all events in chronological order (oldest first)
  const allEvents = await prisma.premiumEvent.findMany({
    orderBy: { blockTimestamp: 'asc' },
  });

  console.log(`  Processing ${allEvents.length} events chronologically`);

  // Build user states by replaying events
  const userStates = new Map<string, { tier: UserTier; lastEventIndex: string }>();

  for (const event of allEvents) {
    if (event.deltaType === DeltaType.OTHER) continue;

    const currentTier = userStates.get(event.accountId)?.tier || UserTier.BASIC;
    const newTier = computeNewTier(currentTier, event.deltaType as DeltaType);

    userStates.set(event.accountId, {
      tier: newTier,
      lastEventIndex: event.eventIndex,
    });
  }

  // Write final states to database (use upsert to handle any existing records)
  for (const [accountId, state] of userStates.entries()) {
    await prisma.premiumUser.upsert({
      where: { accountId },
      update: {
        tier: state.tier,
        lastEventIndex: state.lastEventIndex,
      },
      create: {
        accountId,
        tier: state.tier,
        lastEventIndex: state.lastEventIndex,
      },
    });
  }

  // Count by tier
  const tierCounts = {
    premium: Array.from(userStates.values()).filter(s => s.tier === UserTier.PREMIUM).length,
    ambassador: Array.from(userStates.values()).filter(s => s.tier === UserTier.AMBASSADOR).length,
    basic: Array.from(userStates.values()).filter(s => s.tier === UserTier.BASIC).length,
  };

  console.log(`  ✅ Rebuilt ${userStates.size} users: ${tierCounts.premium} premium, ${tierCounts.ambassador} ambassador, ${tierCounts.basic} basic`);

  return {
    usersProcessed: userStates.size,
    tierCounts,
  };
}

/**
 * Run the premium indexer
 * Step 1: Fetches new events from API (newest to oldest), always starting from newest
 * Step 2: Rebuilds user tiers from all events (oldest to newest)
 * 
 * The API returns transactions in descending order (newest first).
 * We always start from the newest (no cursor) and paginate backwards until
 * we hit transactions we've already indexed.
 */
export async function runPremiumIndexer(): Promise<{
  pagesProcessed: number;
  eventsProcessed: number;
  newCursor: string | null;
  usersRebuilt: number;
  tierCounts: { premium: number; ambassador: number; basic: number };
}> {
  const client = getNearBlocksClient();
  const maxPages = client.getMaxPagesPerRun();
  const pageLimit = client.getPageLimit();

  // Get current state (for informational purposes)
  let state = await prisma.premiumState.findUnique({
    where: { id: 1 },
  });

  if (!state) {
    // Initialize state
    state = await prisma.premiumState.create({
      data: { id: 1, cursor: null },
    });
  }

  // Always start from newest transactions (no cursor)
  // We'll paginate backwards and stop when we hit already-indexed events
  let paginationCursor: string | undefined = undefined;
  let pagesProcessed = 0;
  let eventsProcessed = 0;
  let reachedIndexedEvents = false;
  let newestEventIndex: string | null = null;

  console.log(`📊 Starting premium indexer. Starting from newest transactions.`);
  console.log(`📊 Last known cursor: ${state.cursor || 'null (first run)'}`);

  while (pagesProcessed < maxPages && !reachedIndexedEvents) {
    try {
      const response = await client.getAccountFtTxns(
        PREMIUM_ACCOUNT,
        paginationCursor,
        pageLimit
      );

      if (!response.txns || response.txns.length === 0) {
        console.log('📊 No more transactions to process');
        break;
      }

      console.log(
        `📊 Processing page ${pagesProcessed + 1} with ${response.txns.length} transactions`
      );

      // Process transactions in the page (they come newest first)
      let newEventsInPage = 0;
      let alreadyIndexedInPage = 0;
      
      for (const txn of response.txns) {
        // Track the newest event index we've seen (first txn on first page)
        if (newestEventIndex === null) {
          newestEventIndex = txn.event_index;
        }

        // Check if we've already processed this event_index
        const existingEvent = await prisma.premiumEvent.findUnique({
          where: { eventIndex: txn.event_index },
        });

        if (existingEvent) {
          alreadyIndexedInPage++;
          continue;
        }

        // Process new event
        const processed = await processPremiumEvent(txn);
        if (processed) {
          eventsProcessed++;
          newEventsInPage++;
        }
      }

      console.log(`📊 Page ${pagesProcessed + 1}: ${newEventsInPage} new, ${alreadyIndexedInPage} already indexed`);

      // If we found any already-indexed events, we've caught up
      // (we've reached the point where we left off last time)
      if (alreadyIndexedInPage > 0) {
        console.log(`📊 Reached already-indexed events - caught up with history`);
        reachedIndexedEvents = true;
      }

      pagesProcessed++;

      // Use the response cursor to paginate to older transactions
      paginationCursor = response.cursor || undefined;

      // Stop if no more pages
      if (!response.cursor) {
        console.log('📊 Reached end of transaction history');
        break;
      }
    } catch (error) {
      console.error('❌ Premium indexer error:', error);
      break;
    }
  }

  // Update the cursor to the newest event we've seen (for informational purposes)
  if (newestEventIndex) {
    await prisma.premiumState.update({
      where: { id: 1 },
      data: { cursor: newestEventIndex },
    });
  }

  console.log(
    `✅ Premium indexer step 1 completed. Pages: ${pagesProcessed}, Events: ${eventsProcessed}${reachedIndexedEvents ? ' (caught up)' : ''}`
  );

  // Step 2: Rebuild user tiers from all events in chronological order
  const rebuildResult = await rebuildUserTiersFromEvents();

  return {
    pagesProcessed,
    eventsProcessed,
    newCursor: newestEventIndex,
    usersRebuilt: rebuildResult.usersProcessed,
    tierCounts: rebuildResult.tierCounts,
  };
}

/**
 * Get current premium statistics
 */
export async function getPremiumStats(): Promise<PremiumStats> {
  // Count users by tier
  const [premiumCount, ambassadorCount] = await Promise.all([
    prisma.premiumUser.count({ where: { tier: UserTier.PREMIUM } }),
    prisma.premiumUser.count({ where: { tier: UserTier.AMBASSADOR } }),
  ]);

  // Get 24h window
  const now = new Date();
  const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Count events in last 24h by type
  const [
    premiumSubs24h,
    ambassadorSubs24h,
    upgrades24h,
    premiumDowngrades24h,
    ambassadorDowngrades24h,
  ] = await Promise.all([
    prisma.premiumEvent.count({
      where: {
        deltaType: DeltaType.SUB_PREMIUM,
        blockTimestamp: { gte: past24h },
      },
    }),
    prisma.premiumEvent.count({
      where: {
        deltaType: DeltaType.SUB_AMBASSADOR,
        blockTimestamp: { gte: past24h },
      },
    }),
    prisma.premiumEvent.count({
      where: {
        deltaType: DeltaType.UPGRADE,
        blockTimestamp: { gte: past24h },
      },
    }),
    prisma.premiumEvent.count({
      where: {
        deltaType: DeltaType.DOWNGRADE_PREMIUM,
        blockTimestamp: { gte: past24h },
      },
    }),
    prisma.premiumEvent.count({
      where: {
        deltaType: DeltaType.DOWNGRADE_AMBASSADOR,
        blockTimestamp: { gte: past24h },
      },
    }),
  ]);

  // Calculate net changes
  // Premium change = new premium subs + upgrades from ambassador - downgrades to basic
  const premiumChange24h = premiumSubs24h + upgrades24h - premiumDowngrades24h;
  
  // Ambassador change = new ambassador subs - upgrades to premium - downgrades to basic
  const ambassadorChange24h = ambassadorSubs24h - upgrades24h - ambassadorDowngrades24h;

  // Total unsubscribes
  const unsubscribes24h = premiumDowngrades24h + ambassadorDowngrades24h;

  // Count total premium events
  const totalTransactions = await prisma.premiumEvent.count();

  // Get state
  const state = await prisma.premiumState.findUnique({
    where: { id: 1 },
  });

  return {
    premiumUsers: premiumCount,
    premiumUsersChange24h: premiumChange24h,
    ambassadorUsers: ambassadorCount,
    ambassadorUsersChange24h: ambassadorChange24h,
    premiumSubscriptions24h: premiumSubs24h,
    ambassadorSubscriptions24h: ambassadorSubs24h,
    upgrades24h,
    unsubscribes24h,
    paidUsers: premiumCount + ambassadorCount,
    totalTransactions,
    locked: {
      premium: premiumCount * CONSTANTS.PREMIUM_TOKENS,
      ambassador: ambassadorCount * CONSTANTS.AMBASSADOR_TOKENS,
      total:
        premiumCount * CONSTANTS.PREMIUM_TOKENS +
        ambassadorCount * CONSTANTS.AMBASSADOR_TOKENS,
    },
    lastIndexedAt: state?.updatedAt || null,
    cursor: state?.cursor || null,
  };
}

/**
 * Write current premium stats as snapshots
 */
export async function snapshotPremiumStats(): Promise<void> {
  const [premiumCount, ambassadorCount] = await Promise.all([
    prisma.premiumUser.count({ where: { tier: UserTier.PREMIUM } }),
    prisma.premiumUser.count({ where: { tier: UserTier.AMBASSADOR } }),
  ]);

  await Promise.all([
    writeSnapshot(CONSTANTS.SNAPSHOT_KEYS.PREMIUM_USER_COUNT, premiumCount),
    writeSnapshot(CONSTANTS.SNAPSHOT_KEYS.AMBASSADOR_USER_COUNT, ambassadorCount),
  ]);

  console.log(`📸 Snapshotted premium stats: ${premiumCount} premium, ${ambassadorCount} ambassador`);
}
