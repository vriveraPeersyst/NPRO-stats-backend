import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getEnv } from '../config/env.js';
import { runFastSync } from '../sync/fastSync.js';
import { runSlowSync } from '../sync/slowSync.js';
import { prisma } from '../db/prisma.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Admin API Routes
// Protected endpoints for manual sync triggers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface AdminRequestHeaders {
  'x-sync-secret'?: string;
}

/**
 * Verify sync secret middleware
 */
function verifySyncSecret(
  request: FastifyRequest<{ Headers: AdminRequestHeaders }>,
  reply: FastifyReply
): boolean {
  const env = getEnv();
  const providedSecret = request.headers['x-sync-secret'];

  if (!providedSecret || providedSecret !== env.SYNC_SECRET) {
    reply.status(401).send({ error: 'Unauthorized' });
    return false;
  }

  return true;
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Manual trigger for fast sync
   */
  app.post(
    '/admin/sync/fast',
    async (request: FastifyRequest<{ Headers: AdminRequestHeaders }>, reply: FastifyReply) => {
      if (!verifySyncSecret(request, reply)) {
        return;
      }

      try {
        app.log.info('Manual fast sync triggered');
        const result = await runFastSync();

        return reply.send({
          status: result.success ? 'ok' : 'partial',
          ...result,
        });
      } catch (error) {
        app.log.error({ error }, 'Manual fast sync error');
        return reply.status(500).send({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * Manual trigger for slow sync
   */
  app.post(
    '/admin/sync/slow',
    async (request: FastifyRequest<{ Headers: AdminRequestHeaders }>, reply: FastifyReply) => {
      if (!verifySyncSecret(request, reply)) {
        return;
      }

      try {
        app.log.info('Manual slow sync triggered');
        const result = await runSlowSync();

        return reply.send({
          status: result.success ? 'ok' : 'partial',
          ...result,
        });
      } catch (error) {
        app.log.error({ error }, 'Manual slow sync error');
        return reply.status(500).send({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * Get RPC status
   */
  app.get(
    '/admin/rpc/status',
    async (request: FastifyRequest<{ Headers: AdminRequestHeaders }>, reply: FastifyReply) => {
      if (!verifySyncSecret(request, reply)) {
        return;
      }

      try {
        // Lazy load to avoid initialization issues
        const { getNearRpcManager } = await import('../services/nearRpcManager.js');
        const rpcManager = getNearRpcManager();

        return reply.send({
          status: 'ok',
          rpc: rpcManager.getStatus(),
        });
      } catch (error) {
        return reply.status(500).send({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * Rebuild premium user tiers from events (replay in chronological order)
   */
  app.post(
    '/admin/premium/rebuild-tiers',
    async (request: FastifyRequest<{ Headers: AdminRequestHeaders }>, reply: FastifyReply) => {
      if (!verifySyncSecret(request, reply)) {
        return;
      }

      try {
        app.log.info('🔄 Rebuilding premium user tiers from events...');

        // Delete all existing users
        const deleted = await prisma.premiumUser.deleteMany({});
        app.log.info(`Deleted ${deleted.count} existing user records`);

        // Get all events in chronological order (oldest first)
        const allEvents = await prisma.premiumEvent.findMany({
          orderBy: { blockTimestamp: 'asc' },
        });

        app.log.info(`Processing ${allEvents.length} events in chronological order`);

        const userStates = new Map<string, { tier: string; lastEventIndex: string }>();

        // Replay events to compute final state
        for (const event of allEvents) {
          if (event.deltaType === 'OTHER') continue;

          const currentTier = userStates.get(event.accountId)?.tier || 'BASIC';
          let newTier = currentTier;

          // Compute new tier based on delta type
          switch (event.deltaType) {
            case 'SUB_PREMIUM':
              newTier = 'PREMIUM';
              break;
            case 'SUB_AMBASSADOR':
              newTier = 'AMBASSADOR';
              break;
            case 'UPGRADE':
              newTier = 'PREMIUM';
              break;
            case 'DOWNGRADE_PREMIUM':
              newTier = 'BASIC';
              break;
            case 'DOWNGRADE_AMBASSADOR':
              newTier = 'BASIC';
              break;
          }

          userStates.set(event.accountId, {
            tier: newTier,
            lastEventIndex: event.eventIndex,
          });
        }

        // Write final states to database
        let created = 0;
        for (const [accountId, state] of userStates.entries()) {
          await prisma.premiumUser.create({
            data: {
              accountId,
              tier: state.tier as any,
              lastEventIndex: state.lastEventIndex,
            },
          });
          created++;
        }

        app.log.info(`✅ Rebuilt ${created} user records`);

        // Count by tier
        const tierCounts = await prisma.premiumUser.groupBy({
          by: ['tier'],
          _count: { tier: true },
        });

        return reply.send({
          status: 'ok',
          message: 'User tiers rebuilt successfully',
          eventsProcessed: allEvents.length,
          usersCreated: created,
          tierCounts: Object.fromEntries(tierCounts.map(t => [t.tier, t._count.tier])),
        });
      } catch (error) {
        app.log.error({ error }, 'Failed to rebuild user tiers');
        return reply.status(500).send({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * Investigate premium indexer discrepancy
   */
  app.get(
    '/admin/premium/investigate',
    async (request: FastifyRequest<{ Headers: AdminRequestHeaders }>, reply: FastifyReply) => {
      if (!verifySyncSecret(request, reply)) {
        return;
      }

      try {
        // 1. Count events by delta type
        const eventsByType = await prisma.premiumEvent.groupBy({
          by: ['deltaType'],
          _count: { deltaType: true },
        });

        // 2. Get 'OTHER' events
        const otherEvents = await prisma.premiumEvent.findMany({
          where: { deltaType: 'OTHER' },
          orderBy: { blockTimestamp: 'desc' },
          take: 50,
          select: {
            accountId: true,
            deltaAmountRaw: true,
            blockTimestamp: true,
            txHash: true,
          },
        });

        // 3. Count users by tier
        const usersByTier = await prisma.premiumUser.groupBy({
          by: ['tier'],
          _count: { tier: true },
        });

        // 4. Calculate expected locked amounts
        const premiumCount = usersByTier.find(g => g.tier === 'PREMIUM')?._count.tier || 0;
        const ambassadorCount = usersByTier.find(g => g.tier === 'AMBASSADOR')?._count.tier || 0;

        const expectedLocked = {
          premium: premiumCount * 250,
          ambassador: ambassadorCount * 75,
          total: premiumCount * 250 + ambassadorCount * 75,
        };

        // 5. Check unique accounts coverage
        const uniqueAccountsInEvents = await prisma.premiumEvent.findMany({
          distinct: ['accountId'],
          select: { accountId: true },
        });

        const accountsInUsersTable = await prisma.premiumUser.findMany({
          select: { accountId: true, tier: true },
        });

        const eventAccountSet = new Set(uniqueAccountsInEvents.map(a => a.accountId));
        const userAccountSet = new Set(accountsInUsersTable.map(a => a.accountId));

        const inEventsNotUsers = [...eventAccountSet].filter(a => !userAccountSet.has(a));
        const inUsersNotEvents = [...userAccountSet].filter(a => !eventAccountSet.has(a));

        // 6. Get total event count
        const totalEvents = await prisma.premiumEvent.count();

        return reply.send({
          status: 'ok',
          timestamp: new Date().toISOString(),
          eventsByType: Object.fromEntries(
            eventsByType.map(g => [g.deltaType, g._count.deltaType])
          ),
          totalEvents,
          usersByTier: Object.fromEntries(
            usersByTier.map(g => [g.tier, g._count.tier])
          ),
          expectedLocked,
          actualOnChain: 79700,
          discrepancy: 79700 - expectedLocked.total,
          otherEventsCount: otherEvents.length,
          otherEventsSample: otherEvents.slice(0, 10).map(e => ({
            account: e.accountId,
            amountNPRO: Number(e.deltaAmountRaw) / 1e24,
            amountRaw: e.deltaAmountRaw,
            date: e.blockTimestamp,
            txHash: e.txHash,
          })),
          accountCoverage: {
            uniqueInEvents: uniqueAccountsInEvents.length,
            totalInUsersTable: accountsInUsersTable.length,
            inEventsNotInUsers: inEventsNotUsers.length,
            inUsersNotInEvents: inUsersNotEvents.length,
            missingFromUsers: inEventsNotUsers.slice(0, 20),
          },
        });
      } catch (error) {
        app.log.error({ error }, 'Investigation failed');
        return reply.status(500).send({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * Reset premium data (TEMPORARY - for data cleanup)
   */
  app.post(
    '/admin/reset-premium',
    async (request: FastifyRequest<{ Headers: AdminRequestHeaders }>, reply: FastifyReply) => {
      if (!verifySyncSecret(request, reply)) {
        return;
      }

      try {
        app.log.warn('🗑️  Resetting ALL premium data...');

        // Delete all premium events
        const eventsDeleted = await prisma.premiumEvent.deleteMany({});
        app.log.info(`Deleted ${eventsDeleted.count} premium events`);

        // Delete all premium users
        const usersDeleted = await prisma.premiumUser.deleteMany({});
        app.log.info(`Deleted ${usersDeleted.count} premium users`);

        // Reset premium state (clear cursor)
        await prisma.premiumState.upsert({
          where: { id: 1 },
          update: { cursor: null },
          create: { id: 1, cursor: null },
        });
        app.log.info('Reset premium state (cursor cleared)');

        return reply.send({
          status: 'ok',
          message: 'Premium data reset complete',
          deleted: {
            events: eventsDeleted.count,
            users: usersDeleted.count,
          },
        });
      } catch (error) {
        app.log.error({ error }, 'Failed to reset premium data');
        return reply.status(500).send({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
}
