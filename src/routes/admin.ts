import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getEnv } from '../config/env.js';
import { runFastSync } from '../sync/fastSync.js';
import { runSlowSync } from '../sync/slowSync.js';

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
}
