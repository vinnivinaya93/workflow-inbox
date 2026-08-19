import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { UseCases } from '../../composition/container.js';
import { toProblem } from './problemDetails.js';
import { registerHealthRoutes, type HealthDeps } from './routes/healthRoutes.js';
import { registerInboxItemRoutes } from './routes/inboxItemRoutes.js';
import { registerMetricsRoutes } from './routes/metricsRoutes.js';

export interface HttpAppOptions {
  readonly useCases: UseCases;
  readonly health: HealthDeps;
  /** `false` silences logging (tests); a real pino instance wires it up (production). */
  readonly logger: Logger | false;
}

export function buildHttpApp(options: HttpAppOptions): FastifyInstance {
  const app = Fastify({
    // Fastify 5 takes a config object/boolean via `logger`; a pre-built instance goes
    // through `loggerInstance` instead — passing it as `logger` throws at startup. Pino's
    // Logger is structurally compatible with FastifyBaseLogger; the cast just satisfies the
    // two packages' independently-declared (and not quite identical) type definitions.
    ...(options.logger === false
      ? { logger: false as const }
      : { loggerInstance: options.logger as unknown as FastifyBaseLogger }),
    // Trust an inbound id so a request can be followed across services; mint one otherwise.
    genReqId: (request) => (request.headers['x-request-id'] as string | undefined) ?? randomUUID(),
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.setErrorHandler((error, request, reply) => {
    const problem = toProblem(error, String(request.id), request.url);

    if (problem.status >= 500) {
      request.log.error({ err: error, code: problem.code }, 'unhandled error');
    } else {
      // Expected outcomes (409 on a double-click, 403 on a stale tab) are not incidents.
      request.log.info({ code: problem.code, status: problem.status }, 'request rejected');
    }

    return reply.code(problem.status).type('application/problem+json').send(problem);
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).type('application/problem+json').send({
      type: 'https://workflow-inbox.internal/problems/route-not-found',
      title: 'Not found', status: 404, code: 'ROUTE_NOT_FOUND',
      detail: `No route for ${request.method} ${request.url}`,
      instance: request.url, requestId: String(request.id),
    }),
  );

  registerHealthRoutes(app, options.health);
  registerMetricsRoutes(app);
  registerInboxItemRoutes(app, options.useCases);
  return app;
}
