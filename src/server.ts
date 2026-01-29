import Fastify from 'fastify';
import { validateEnvAtStartup } from './config/env.js';
import { prisma, disconnectPrisma } from './db/prisma.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerAdminRoutes } from './routes/admin.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NPRO Stats Backend Server
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  // Validate environment at startup
  const env = validateEnvAtStartup();

  // Create Fastify instance
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
  });

  // Register routes
  await registerPublicRoutes(app);
  await registerAdminRoutes(app);

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down...`);
      await app.close();
      await disconnectPrisma();
      process.exit(0);
    });
  }

  // Start server
  try {
    const address = await app.listen({
      port: env.PORT,
      host: '0.0.0.0',
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 NPRO Stats Backend Server');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   Server running at: ${address}`);
    console.log(`   Environment: ${env.NODE_ENV}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('   Endpoints:');
    console.log('     GET  /health             - Health check');
    console.log('     GET  /v1/npro/summary    - Full NPRO dashboard data');
    console.log('     POST /admin/sync/fast    - Manual fast sync (protected)');
    console.log('     POST /admin/sync/slow    - Manual slow sync (protected)');
    console.log('     GET  /admin/rpc/status   - RPC endpoint status (protected)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (err: unknown) {
    app.log.error(err);
    await disconnectPrisma();
    process.exit(1);
  }
}

// Test database connection before starting
prisma
  .$connect()
  .then(() => {
    console.log('✅ Database connected');
    return main();
  })
  .catch((err: unknown) => {
    console.error('❌ Database connection failed:', err);
    process.exit(1);
  });
