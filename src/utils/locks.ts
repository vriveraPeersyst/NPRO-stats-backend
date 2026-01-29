import { prisma } from '../db/prisma.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PostgreSQL Advisory Lock Helpers
// Used to prevent overlapping sync runs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Try to acquire a session-level advisory lock.
 * Returns true if lock was acquired, false if already held by another session.
 */
export async function tryAcquireLock(lockKey: string): Promise<boolean> {
  const result = await prisma.$queryRaw<Array<{ pg_try_advisory_lock: boolean }>>`
    SELECT pg_try_advisory_lock(hashtext(${lockKey}))
  `;
  return result[0]?.pg_try_advisory_lock ?? false;
}

/**
 * Release a session-level advisory lock.
 */
export async function releaseLock(lockKey: string): Promise<void> {
  await prisma.$queryRaw`
    SELECT pg_advisory_unlock(hashtext(${lockKey}))
  `;
}

/**
 * Execute a function with an advisory lock.
 * If lock cannot be acquired, logs and exits with code 0 (success for cron).
 */
export async function withLock<T>(
  lockKey: string,
  fn: () => Promise<T>
): Promise<T | null> {
  const acquired = await tryAcquireLock(lockKey);

  if (!acquired) {
    console.log(`⏳ Lock "${lockKey}" is held by another process. Exiting gracefully.`);
    return null;
  }

  console.log(`🔒 Acquired lock: ${lockKey}`);

  try {
    return await fn();
  } finally {
    await releaseLock(lockKey);
    console.log(`🔓 Released lock: ${lockKey}`);
  }
}
