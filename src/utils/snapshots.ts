import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../db/prisma.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Snapshot Helpers
// Write and query snapshots for delta calculations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Write a numeric snapshot for a given key
 */
export async function writeSnapshot(
  key: string,
  valueNumeric: number | string | Decimal,
  ts: Date = new Date()
): Promise<void> {
  await prisma.metricSnapshot.create({
    data: {
      key,
      ts,
      valueNumeric: new Decimal(valueNumeric.toString()),
    },
  });
}

/**
 * Get the current value for a snapshot key (most recent)
 */
export async function getCurrentSnapshotValue(key: string): Promise<Decimal | null> {
  const snapshot = await prisma.metricSnapshot.findFirst({
    where: { key },
    orderBy: { ts: 'desc' },
  });
  return snapshot?.valueNumeric ?? null;
}

/**
 * Get snapshot value at or before a specific timestamp
 */
export async function getSnapshotValueAtOrBefore(
  key: string,
  before: Date
): Promise<Decimal | null> {
  const snapshot = await prisma.metricSnapshot.findFirst({
    where: {
      key,
      ts: { lte: before },
    },
    orderBy: { ts: 'desc' },
  });
  return snapshot?.valueNumeric ?? null;
}

/**
 * Calculate delta from 24 hours ago
 * Returns: current - snapshot_at_or_before(now - 24h)
 */
export async function getDelta24h(key: string, currentValue: number | string | Decimal): Promise<number> {
  const now = new Date();
  const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const pastSnapshot = await getSnapshotValueAtOrBefore(key, past24h);

  if (!pastSnapshot) {
    return 0;
  }

  const current = new Decimal(currentValue.toString());
  return current.minus(pastSnapshot).toNumber();
}

/**
 * Get both current value and 24h delta for a key
 */
export async function getSnapshotWithDelta(key: string): Promise<{
  current: number | null;
  delta24h: number;
}> {
  const currentSnapshot = await getCurrentSnapshotValue(key);

  if (!currentSnapshot) {
    return { current: null, delta24h: 0 };
  }

  const delta24h = await getDelta24h(key, currentSnapshot);

  return {
    current: currentSnapshot.toNumber(),
    delta24h,
  };
}

/**
 * Cleanup old snapshots (keep last 7 days)
 */
export async function cleanupOldSnapshots(daysToKeep: number = 7): Promise<number> {
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

  const result = await prisma.metricSnapshot.deleteMany({
    where: {
      ts: { lt: cutoff },
    },
  });

  return result.count;
}
