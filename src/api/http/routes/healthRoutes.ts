import type { FastifyInstance } from 'fastify';

export interface HealthDeps {
  /** Resolves if dependencies are usable; rejects otherwise. */
  readonly checkReadiness: () => Promise<void>;
  readonly version: string;
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  // Liveness: is the process up? Never touches dependencies — a slow database must not
  // get the container killed and restarted into the same slow database.
  app.get('/healthz', async () => ({ status: 'ok', version: deps.version }));

  // Readiness: should this instance receive traffic?
  app.get('/readyz', async (_request, reply) => {
    try {
      await deps.checkReadiness();
      return reply.send({ status: 'ready' });
    } catch (error) {
      app.log.warn({ err: error }, 'readiness check failed');
      return reply.code(503).send({ status: 'not-ready' });
    }
  });
}
