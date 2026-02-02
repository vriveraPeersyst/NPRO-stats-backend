import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetPremiumData() {
  try {
    console.log('🗑️  Resetting premium data...\n');

    // Delete all premium events
    const eventsDeleted = await prisma.premiumEvent.deleteMany({});
    console.log(`✅ Deleted ${eventsDeleted.count} premium events`);

    // Delete all premium users
    const usersDeleted = await prisma.premiumUser.deleteMany({});
    console.log(`✅ Deleted ${usersDeleted.count} premium users`);

    // Reset premium state (clear cursor)
    await prisma.premiumState.upsert({
      where: { id: 1 },
      update: { cursor: null },
      create: { id: 1, cursor: null },
    });
    console.log(`✅ Reset premium state (cursor cleared)`);

    console.log('\n✅ Premium data reset complete!');
    console.log('Next slow sync will reindex all premium transactions from the beginning.\n');

  } catch (error) {
    console.error('❌ Error resetting premium data:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

resetPremiumData();
