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
import { writeSnapshot, getDelta24h } from '../utils/snapshots.js';

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
  upgrades24h: number;
  unsubscribes24h: number;
  paidUsers: number;
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

  // Create the event record
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

  // Update user tier if it's a known action
  if (deltaType !== 'OTHER') {
    const existingUser = await prisma.premiumUser.findUnique({
      where: { accountId: txn.involved_account_id },
    });

    const currentTier = existingUser?.tier ?? UserTier.BASIC;
    const newTier = computeNewTier(currentTier as UserTier, prismaDeltaType);

    await prisma.premiumUser.upsert({
      where: { accountId: txn.involved_account_id },
      update: {
        tier: newTier,
        lastEventIndex: txn.event_index,
        updatedAt: new Date(),
      },
      create: {
        accountId: txn.involved_account_id,
        tier: newTier,
        lastEventIndex: txn.event_index,
      },
    });
  }

  return true;
}

/**
 * Run the premium indexer
 * Fetches transactions in pages and processes them
 */
export async function runPremiumIndexer(): Promise<{
  pagesProcessed: number;
  eventsProcessed: number;
  newCursor: string | null;
}> {
  const client = getNearBlocksClient();
  const maxPages = client.getMaxPagesPerRun();
  const pageLimit = client.getPageLimit();

  // Get current state
  let state = await prisma.premiumState.findUnique({
    where: { id: 1 },
  });

  if (!state) {
    // Initialize state
    state = await prisma.premiumState.create({
      data: { id: 1, cursor: null },
    });
  }

  let cursor = state.cursor;
  let pagesProcessed = 0;
  let eventsProcessed = 0;

  console.log(`📊 Starting premium indexer. Current cursor: ${cursor || 'null'}`);

  while (pagesProcessed < maxPages) {
    try {
      const response = await client.getAccountFtTxns(
        PREMIUM_ACCOUNT,
        cursor || undefined,
        pageLimit
      );

      if (!response.txns || response.txns.length === 0) {
        console.log('📊 No more transactions to process');
        break;
      }

      console.log(
        `📊 Processing page ${pagesProcessed + 1} with ${response.txns.length} transactions`
      );

      // Process transactions (oldest first for correct state tracking)
      // Note: NearBlocks returns newest first, so we might need to reverse
      // Actually, for incremental indexing we want newest first to catch up
      for (const txn of response.txns) {
        const processed = await processPremiumEvent(txn);
        if (processed) {
          eventsProcessed++;
        }
      }

      pagesProcessed++;
      cursor = response.cursor;

      // Update state with new cursor
      await prisma.premiumState.update({
        where: { id: 1 },
        data: { cursor },
      });

      // If no more pages
      if (!response.cursor) {
        console.log('📊 Reached end of transactions');
        break;
      }
    } catch (error) {
      console.error('❌ Premium indexer error:', error);
      break;
    }
  }

  console.log(
    `✅ Premium indexer completed. Pages: ${pagesProcessed}, Events: ${eventsProcessed}`
  );

  return {
    pagesProcessed,
    eventsProcessed,
    newCursor: cursor,
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

  // Count events in last 24h
  const [upgrades24h, unsubscribes24h] = await Promise.all([
    prisma.premiumEvent.count({
      where: {
        deltaType: DeltaType.UPGRADE,
        blockTimestamp: { gte: past24h },
      },
    }),
    prisma.premiumEvent.count({
      where: {
        deltaType: { in: [DeltaType.DOWNGRADE_PREMIUM, DeltaType.DOWNGRADE_AMBASSADOR] },
        blockTimestamp: { gte: past24h },
      },
    }),
  ]);

  // Get 24h change for premium and ambassador counts
  const premiumDelta24h = await getDelta24h(
    CONSTANTS.SNAPSHOT_KEYS.PREMIUM_USER_COUNT,
    premiumCount
  );
  const ambassadorDelta24h = await getDelta24h(
    CONSTANTS.SNAPSHOT_KEYS.AMBASSADOR_USER_COUNT,
    ambassadorCount
  );

  // Get state
  const state = await prisma.premiumState.findUnique({
    where: { id: 1 },
  });

  return {
    premiumUsers: premiumCount,
    premiumUsersChange24h: premiumDelta24h,
    ambassadorUsers: ambassadorCount,
    ambassadorUsersChange24h: ambassadorDelta24h,
    upgrades24h,
    unsubscribes24h,
    paidUsers: premiumCount + ambassadorCount,
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
