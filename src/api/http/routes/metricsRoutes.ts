import type { FastifyInstance } from 'fastify';
import { conflicts, httpDuration, registry } from '../../../infrastructure/observability/metrics.js';

export function registerMetricsRoutes(app: FastifyInstance): void {
  app.addHook('onResponse', async (request, reply) => {
    httpDuration.observe(
      {
        method: request.method,
        route: request.routeOptions.url ?? 'unmatched', // pattern, not resolved URL
        status: String(reply.statusCode),
      },
      reply.elapsedTime / 1000,
    );
    if (reply.statusCode === 409) conflicts.inc({ code: 'http_409' });
  });

  app.get('/metrics', async (_request, reply) =>
    reply.type(registry.contentType).send(await registry.metrics()),
  );
}
