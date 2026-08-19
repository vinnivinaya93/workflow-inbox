import { buildHttpApp } from './api/http/buildHttpApp.js';
import { registerWebRoutes } from './api/web/routes/registerWebRoutes.js';
import { loadConfig } from './config.js';
import { buildContainer } from './composition/container.js';
import { seedDemoData } from './composition/seed.js';
import { createLogger } from './infrastructure/observability/logger.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const container = buildContainer(config);

if (config.seedDemoData) await seedDemoData(container.useCases);

const app = buildHttpApp({
  useCases: container.useCases,
  health: { checkReadiness: container.checkReadiness, version: process.env.APP_VERSION ?? 'dev' },
  logger,
});
await registerWebRoutes(app, container.useCases); // registers @fastify/formbody, so it awaits

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void (async () => {
      logger.info({ signal }, 'shutting down');
      await app.close(); // stop accepting, drain in-flight requests
      await container.shutdown(); // then release the pool
      process.exit(0);
    })();
  });
}

await app.listen({ port: config.port, host: '0.0.0.0' });
logger.info({ port: config.port, store: config.store }, 'workflow inbox listening');
