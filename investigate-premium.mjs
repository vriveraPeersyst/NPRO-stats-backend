#!/usr/bin/env node
/**
 * Investigate premium indexer discrepancy
 * - Check for 'OTHER' type events that might be valid subscriptions
 * - Look for unusual delta amounts
 * - Verify user tier counts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function investigate() {
  console.log('🔍 Investigating premium indexer discrepancy...\n');

  // 1. Count events by delta type
  console.log('━━━ Events by Delta Type ━━━');
  const eventsByType = await prisma.premiumEvent.groupBy({
    by: ['deltaType'],
    _count: { deltaType: true },
  });
  
  for (const group of eventsByType) {
    console.log(`  ${group.deltaType}: ${group._count.deltaType}`);
  }
  
  const totalEvents = eventsByType.reduce((sum, g) => sum + g._count.deltaType, 0);
  console.log(`  TOTAL EVENTS: ${totalEvents}\n`);

  // 2. Check 'OTHER' events - these might be the missing subscriptions
  console.log('━━━ OTHER Type Events (showing first 20) ━━━');
  const otherEvents = await prisma.premiumEvent.findMany({
    where: { deltaType: 'OTHER' },
    orderBy: { blockTimestamp: 'desc' },
    take: 20,
  });

  if (otherEvents.length === 0) {
    console.log('  No OTHER events found\n');
  } else {
    console.log(`  Found ${otherEvents.length} OTHER events (showing details):\n`);
    for (const event of otherEvents) {
      const formatted = Number(event.deltaAmountRaw) / 1e24;
      console.log(`  Account: ${event.accountId}`);
      console.log(`  Amount: ${formatted.toFixed(2)} NPRO (raw: ${event.deltaAmountRaw})`);
      console.log(`  Date: ${event.blockTimestamp.toISOString()}`);
      console.log(`  TxHash: ${event.txHash}`);
      console.log('  ---');
    }
    console.log();
  }

  // 3. Count users by tier
  console.log('━━━ Users by Tier ━━━');
  const usersByTier = await prisma.premiumUser.groupBy({
    by: ['tier'],
    _count: { tier: true },
  });
  
  for (const group of usersByTier) {
    console.log(`  ${group.tier}: ${group._count.tier}`);
  }
  
  const totalUsers = usersByTier.reduce((sum, g) => sum + g._count.tier, 0);
  console.log(`  TOTAL USERS: ${totalUsers}\n`);

  // 4. Calculate expected locked amounts
  const premiumCount = usersByTier.find(g => g.tier === 'PREMIUM')?._count.tier || 0;
  const ambassadorCount = usersByTier.find(g => g.tier === 'AMBASSADOR')?._count.tier || 0;
  const basicCount = usersByTier.find(g => g.tier === 'BASIC')?._count.tier || 0;

  const expectedPremium = premiumCount * 250;
  const expectedAmbassador = ambassadorCount * 75;
  const expectedTotal = expectedPremium + expectedAmbassador;

  console.log('━━━ Expected Locked Amounts ━━━');
  console.log(`  Premium: ${premiumCount} users × 250 = ${expectedPremium.toLocaleString()} NPRO`);
  console.log(`  Ambassador: ${ambassadorCount} users × 75 = ${expectedAmbassador.toLocaleString()} NPRO`);
  console.log(`  Total Expected: ${expectedTotal.toLocaleString()} NPRO`);
  console.log(`  Actual On-Chain: 79,700 NPRO`);
  console.log(`  Discrepancy: ${(79700 - expectedTotal).toLocaleString()} NPRO\n`);

  // 5. Check for unique accounts in events vs users table
  const uniqueAccountsInEvents = await prisma.premiumEvent.findMany({
    distinct: ['accountId'],
    select: { accountId: true },
  });

  const accountsInUsersTable = await prisma.premiumUser.findMany({
    select: { accountId: true },
  });

  console.log('━━━ Account Coverage ━━━');
  console.log(`  Unique accounts in events: ${uniqueAccountsInEvents.length}`);
  console.log(`  Accounts in users table: ${accountsInUsersTable.length}`);
  
  const eventAccountSet = new Set(uniqueAccountsInEvents.map(a => a.accountId));
  const userAccountSet = new Set(accountsInUsersTable.map(a => a.accountId));
  
  const inEventsNotUsers = [...eventAccountSet].filter(a => !userAccountSet.has(a));
  const inUsersNotEvents = [...userAccountSet].filter(a => !eventAccountSet.has(a));
  
  if (inEventsNotUsers.length > 0) {
    console.log(`\n  ⚠️ Accounts with events but not in users table: ${inEventsNotUsers.length}`);
    console.log('  First 10:', inEventsNotUsers.slice(0, 10));
  }
  
  if (inUsersNotEvents.length > 0) {
    console.log(`\n  ⚠️ Accounts in users table but no events: ${inUsersNotEvents.length}`);
    console.log('  First 10:', inUsersNotEvents.slice(0, 10));
  }
  console.log();

  // 6. Check for users with tier != BASIC who might have been missed
  console.log('━━━ Sample Premium Users ━━━');
  const samplePremium = await prisma.premiumUser.findMany({
    where: { tier: 'PREMIUM' },
    take: 5,
    orderBy: { updatedAt: 'desc' },
  });
  
  for (const user of samplePremium) {
    console.log(`  ${user.accountId} - updated: ${user.updatedAt.toISOString()}`);
  }

  console.log('\n━━━ Sample Ambassador Users ━━━');
  const sampleAmbassador = await prisma.premiumUser.findMany({
    where: { tier: 'AMBASSADOR' },
    take: 5,
    orderBy: { updatedAt: 'desc' },
  });
  
  for (const user of sampleAmbassador) {
    console.log(`  ${user.accountId} - updated: ${user.updatedAt.toISOString()}`);
  }

  // 7. Check for possible duplicate or conflicting events
  console.log('\n━━━ Checking for Account State Issues ━━━');
  
  // Find accounts with multiple different delta types
  const accountEventCounts = await prisma.premiumEvent.groupBy({
    by: ['accountId', 'deltaType'],
    _count: { deltaType: true },
  });
  
  const accountMap = new Map();
  for (const row of accountEventCounts) {
    if (!accountMap.has(row.accountId)) {
      accountMap.set(row.accountId, []);
    }
    accountMap.get(row.accountId).push({ type: row.deltaType, count: row._count.deltaType });
  }
  
  let conflictingAccounts = 0;
  for (const [account, events] of accountMap.entries()) {
    if (events.length > 1) {
      conflictingAccounts++;
      if (conflictingAccounts <= 5) {
        console.log(`  ${account}: ${events.map(e => `${e.type}(${e.count})`).join(', ')}`);
      }
    }
  }
  
  if (conflictingAccounts > 5) {
    console.log(`  ... and ${conflictingAccounts - 5} more accounts with multiple event types`);
  }

  await prisma.$disconnect();
}

investigate().catch(console.error);
