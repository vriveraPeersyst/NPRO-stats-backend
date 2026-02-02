import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkDuplicates() {
  try {
    // Get all premium users
    const users = await prisma.premiumUser.findMany({
      orderBy: { accountId: 'asc' }
    });
    
    console.log('Total users:', users.length);
    
    // Check for duplicates
    const accountCounts = {};
    users.forEach(u => {
      accountCounts[u.accountId] = (accountCounts[u.accountId] || 0) + 1;
    });
    
    const duplicates = Object.entries(accountCounts).filter(([_, count]) => count > 1);
    
    if (duplicates.length > 0) {
      console.log('\nDuplicate accounts found:', duplicates.length);
      duplicates.forEach(([account, count]) => {
        console.log(`  ${account}: ${count} times`);
        // Show details of duplicates
        const dupeUsers = users.filter(u => u.accountId === account);
        dupeUsers.forEach(u => {
          console.log(`    - Tier: ${u.tier}, Updated: ${u.updatedAt}`);
        });
      });
    } else {
      console.log('\nNo duplicates found!');
    }
    
    // Show tier distribution
    const premium = users.filter(u => u.tier === 'PREMIUM').length;
    const ambassador = users.filter(u => u.tier === 'AMBASSADOR').length;
    const basic = users.filter(u => u.tier === 'BASIC').length;
    
    console.log('\nTier distribution:');
    console.log('  Premium:', premium);
    console.log('  Ambassador:', ambassador);
    console.log('  Basic:', basic);
    
    // Show some sample users
    console.log('\nSample premium users (first 5):');
    users.filter(u => u.tier === 'PREMIUM').slice(0, 5).forEach(u => {
      console.log(`  ${u.accountId}`);
    });
    
    console.log('\nSample ambassador users (first 5):');
    users.filter(u => u.tier === 'AMBASSADOR').slice(0, 5).forEach(u => {
      console.log(`  ${u.accountId}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDuplicates();
