# Stage 4 — HTTP API (Driving Adapter)

> **Goal:** a contract-first JSON API that translates transport into commands and domain errors
> into `application/problem+json`, and contains no business logic whatsoever.
> **In the hour:** yes — ~15 min. The OpenAPI emitter is a 10-line script added the same day.

## Files added

```
contracts/openapi.yaml                      # generated + committed
scripts/emit-openapi.ts
src/api/http/contracts/inboxItemContracts.ts
src/api/http/problemDetails.ts
src/api/http/requestContext.ts
src/api/http/routes/inboxItemRoutes.ts
src/api/http/routes/healthRoutes.ts
src/api/http/buildHttpApp.ts
src/composition/container.ts
src/composition/seed.ts
src/main.ts
```

Adds one **dev** dependency: `@asteasolutions/zod-to-openapi` (generation only — nothing new
ships at runtime).

---

## 4.1 API design decisions

| Choice | Reasoning |
| --- | --- |
| Transitions are sub-resources: `POST …/claim`, `POST …/completion`, `POST …/cancellation` | The URL names the act. `PATCH { status: 'completed' }` would let a client attempt any transition and force the server to reverse-engineer intent; it also has nowhere natural to hang an outcome, a note, or an idempotency scope. |
| `Idempotency-Key` header **required** on `POST …/completion` | The dangerous operation is the one that must be replay-safe. Making it required means no client can accidentally opt out of the guarantee. |
| `X-Actor-Id` header carries identity | Stand-in for real auth, called out loudly in the README as assumption #1. Keeping it in a header rather than the body means swapping in a JWT subject later touches one function. |
| Keyset `cursor` + `limit`, never `page`/`offset` | An inbox has items arriving constantly; offsets skip and duplicate rows under concurrent inserts. |
| `application/problem+json` (RFC 9457) with a machine `code` | Clients branch on `code`, humans read `detail`, and everything correlates by `requestId`. |
| 200 (not 201) from `POST …/completion` | It mutates an existing resource rather than creating one; the body is the updated item, so a client never needs a follow-up GET. |
| The list response advertises `availableActions` | The state machine lives in one place. Clients render what the server says is legal. |

## 4.2 Contracts — one source of truth

The zod schemas are the contract; `contracts/openapi.yaml` is generated from them and committed
so reviewers and consumers can read it, with `npm run openapi:check` failing CI on drift. The
enums and lengths are imported from the domain, so a new `ItemKind` propagates to validation,
the spec and the UI without a second edit.

```ts
// src/api/http/contracts/inboxItemContracts.ts
import { z } from 'zod';
import { NOTE_MAX } from '../../../domain/inbox/value-objects/CompletionNote.js';
import { ITEM_KINDS } from '../../../domain/inbox/value-objects/ItemKind.js';
import { ITEM_STATUSES } from '../../../domain/inbox/value-objects/ItemStatus.js';
import { OUTCOMES } from '../../../domain/inbox/value-objects/Outcome.js';
import { PRIORITIES } from '../../../domain/inbox/value-objects/Priority.js';
import { TITLE_MAX } from '../../../domain/inbox/value-objects/Title.js';
import { MAX_PAGE_SIZE } from '../../../application/use-cases/ListInboxItems.js';

/** Comma-separated repeated query values: ?status=pending,claimed */
const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((raw) => raw.split(',').map((part) => part.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1))
    .optional();

export const ItemIdParams = z.object({ id: z.string().uuid() });

export const CreateItemBody = z.object({
  kind: z.enum(ITEM_KINDS),
  title: z.string().min(1).max(TITLE_MAX),
  assignee: z.string().min(2).max(64),
  priority: z.enum(PRIORITIES).default('normal'),
  dueAt: z.string().datetime({ offset: true }).nullish(),
});

export const ListItemsQuery = z.object({
  status: csv(ITEM_STATUSES),
  kind: csv(ITEM_KINDS),
  assignee: z.string().min(2).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: z.string().min(1).optional(),
});

export const CompleteItemBody = z.object({
  outcome: z.enum(OUTCOMES),
  note: z.string().max(NOTE_MAX).nullish(),
});

export const CancelItemBody = z.object({
  reason: z.string().min(1).max(500),
});

export const ActorHeader = z.object({
  'x-actor-id': z.string().min(2).max(64, 'X-Actor-Id header is required'),
});

export const IdempotencyHeader = z.object({
  'idempotency-key': z.string().min(8).max(128, 'Idempotency-Key header is required'),
});

export type CreateItemBody = z.infer<typeof CreateItemBody>;
export type ListItemsQuery = z.infer<typeof ListItemsQuery>;
export type CompleteItemBody = z.infer<typeof CompleteItemBody>;
```

Two validation layers, with different jobs, and that is intentional rather than redundant: zod
rejects *malformed transport* (wrong type, unknown enum, absent header) with field-level 400s,
and the value objects reject *invalid domain values* (`ActorId` charset, blank-after-trim title)
even when a second adapter — the HTML forms in Stage 6 — is the caller.

```ts
// scripts/emit-openapi.ts (abridged)
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { OpenApiGeneratorV31, OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import * as c from '../src/api/http/contracts/inboxItemContracts.js';

extendZodWithOpenApi(z);
const registry = new OpenAPIRegistry();

registry.registerPath({
  method: 'post',
  path: '/api/inbox-items/{id}/completion',
  summary: 'Complete an inbox item (idempotent)',
  request: {
    params: c.ItemIdParams,
    headers: [c.ActorHeader, c.IdempotencyHeader],
    body: { content: { 'application/json': { schema: c.CompleteItemBody } } },
  },
  responses: {
    200: { description: 'The updated item' },
    403: { description: 'Actor does not hold the item' },
    409: { description: 'Terminal state, or already completed under another key' },
    422: { description: 'Outcome not allowed for this kind' },
  },
});
// … remaining paths registered the same way …

const doc = new OpenApiGeneratorV31(registry.definitions).generateDocument({
  openapi: '3.1.0',
  info: { title: 'Workflow Inbox API', version: '1.0.0' },
});
const yaml = toYaml(doc); // tiny local serialiser; keeps js-yaml out of the tree
const target = new URL('../contracts/openapi.yaml', import.meta.url);

if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current !== yaml) {
    console.error('contracts/openapi.yaml is stale — run `npm run openapi`');
    process.exit(1);
  }
} else {
  writeFileSync(target, yaml);
}
```

## 4.3 Error translation

One function, exhaustively mapped, so no route ever writes a status code by hand.

```ts
// src/api/http/problemDetails.ts
import { ZodError } from 'zod';
import { ApplicationError, ConcurrencyConflict, InvalidCursor, ItemNotFound } from '../../application/errors.js';
import { DomainError, ValidationError } from '../../domain/shared/errors.js';
import {
  CompletionConflict, ItemStateConflict, NotAssignedToActor, OutcomeNotAllowed,
} from '../../domain/inbox/errors.js';

export interface FieldError { readonly field: string; readonly message: string }

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly instance: string;
  readonly requestId: string;
  readonly errors?: readonly FieldError[];
}

const TITLES: Record<number, string> = {
  400: 'Invalid request', 403: 'Forbidden', 404: 'Not found',
  409: 'Conflict', 422: 'Unprocessable entity', 500: 'Internal server error',
};

function statusFor(error: unknown): number {
  if (error instanceof ZodError) return 400;
  if (error instanceof ValidationError) return 400;
  if (error instanceof InvalidCursor) return 400;
  if (error instanceof NotAssignedToActor) return 403;
  if (error instanceof ItemNotFound) return 404;
  if (error instanceof ItemStateConflict) return 409;
  if (error instanceof CompletionConflict) return 409;
  if (error instanceof ConcurrencyConflict) return 409;
  if (error instanceof OutcomeNotAllowed) return 422;
  return 500;
}

function codeFor(error: unknown): string {
  if (error instanceof ZodError) return 'REQUEST_VALIDATION_ERROR';
  if (error instanceof DomainError || error instanceof ApplicationError) return error.code;
  return 'INTERNAL_ERROR';
}

export function toProblem(error: unknown, requestId: string, instance: string): ProblemDetails {
  const status = statusFor(error);
  const code = codeFor(error);

  // A 500 means we do not understand the failure, so the client learns nothing beyond that.
  // The real message and stack go to the log, correlated by requestId.
  const detail =
    status === 500 ? 'An unexpected error occurred.' : (error as Error).message ?? 'Request failed.';

  const errors =
    error instanceof ZodError
      ? error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message }))
      : error instanceof ValidationError
        ? [{ field: error.field, message: error.message }]
        : undefined;

  return {
    type: `https://workflow-inbox.internal/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title: TITLES[status] ?? 'Error',
    status,
    code,
    detail,
    instance,
    requestId,
    ...(errors ? { errors } : {}),
  };
}
```

A concrete response, which is the part reviewers actually judge:

```http
HTTP/1.1 409 Conflict
content-type: application/problem+json
x-request-id: 01J9R2ZK7Q3M

{
  "type": "https://workflow-inbox.internal/problems/item-completion-conflict",
  "title": "Conflict",
  "status": 409,
  "code": "ITEM_COMPLETION_CONFLICT",
  "detail": "item was already completed under idempotency key \"form-6f2a…\"; refusing to re-complete under \"form-91bc…\"",
  "instance": "/api/inbox-items/7b2f1c34-9a5e-4f21-8c0d-1e2f3a4b5c6d/completion",
  "requestId": "01J9R2ZK7Q3M"
}
```

## 4.4 Request context

```ts
// src/api/http/requestContext.ts
import type { FastifyRequest } from 'fastify';
import { actorId, type ActorId } from '../../domain/inbox/value-objects/ActorId.js';
import { idempotencyKey, type IdempotencyKey } from '../../domain/inbox/value-objects/IdempotencyKey.js';
import { ActorHeader, IdempotencyHeader } from './contracts/inboxItemContracts.js';

/**
 * The single place identity enters the system. Replacing this with a verified JWT subject is
 * a change to this function and nothing else — that is the whole reason it exists.
 */
export function actorFrom(request: FastifyRequest): ActorId {
  const headers = ActorHeader.parse(request.headers);
  return actorId(headers['x-actor-id']);
}

export function idempotencyKeyFrom(request: FastifyRequest): IdempotencyKey {
  const headers = IdempotencyHeader.parse(request.headers);
  return idempotencyKey(headers['idempotency-key']);
}
```

## 4.5 Routes

```ts
// src/api/http/routes/inboxItemRoutes.ts
import type { FastifyInstance } from 'fastify';
import { completionNote } from '../../../domain/inbox/value-objects/CompletionNote.js';
import { inboxItemId } from '../../../domain/inbox/value-objects/InboxItemId.js';
import { actorId } from '../../../domain/inbox/value-objects/ActorId.js';
import { outcome } from '../../../domain/inbox/value-objects/Outcome.js';
import { title } from '../../../domain/inbox/value-objects/Title.js';
import type { UseCases } from '../../../composition/container.js';
import {
  CancelItemBody, CompleteItemBody, CreateItemBody, ItemIdParams, ListItemsQuery,
} from '../contracts/inboxItemContracts.js';
import { actorFrom, idempotencyKeyFrom } from '../requestContext.js';

export function registerInboxItemRoutes(app: FastifyInstance, useCases: UseCases): void {
  app.post('/api/inbox-items', async (request, reply) => {
    const body = CreateItemBody.parse(request.body);
    const view = await useCases.createInboxItem.execute({
      kind: body.kind,
      title: title(body.title),
      assignee: actorId(body.assignee),
      priority: body.priority,
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
    });
    return reply.code(201).header('location', `/api/inbox-items/${view.id}`).send(view);
  });

  app.get('/api/inbox-items', async (request, reply) => {
    const query = ListItemsQuery.parse(request.query);
    const result = await useCases.listInboxItems.execute({
      ...(query.status ? { statuses: query.status } : {}),
      ...(query.kind ? { kinds: query.kind } : {}),
      ...(query.assignee ? { assignee: actorId(query.assignee) } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit ?? 25,
    });
    return reply.send(result);
  });

  app.get('/api/inbox-items/:id', async (request, reply) => {
    const { id } = ItemIdParams.parse(request.params);
    return reply.send(await useCases.getInboxItem.execute(inboxItemId(id)));
  });

  app.post('/api/inbox-items/:id/claim', async (request, reply) => {
    const { id } = ItemIdParams.parse(request.params);
    return reply.send(
      await useCases.claimInboxItem.execute({ id: inboxItemId(id), actor: actorFrom(request) }),
    );
  });

  app.post('/api/inbox-items/:id/release', async (request, reply) => {
    const { id } = ItemIdParams.parse(request.params);
    return reply.send(
      await useCases.releaseInboxItem.execute({ id: inboxItemId(id), actor: actorFrom(request) }),
    );
  });

  app.post('/api/inbox-items/:id/completion', async (request, reply) => {
    const { id } = ItemIdParams.parse(request.params);
    const body = CompleteItemBody.parse(request.body ?? {});
    const view = await useCases.completeInboxItem.execute({
      id: inboxItemId(id),
      actor: actorFrom(request),
      outcome: outcome(body.outcome),
      note: body.note ? completionNote(body.note) : null,
      idempotencyKey: idempotencyKeyFrom(request),
    });
    return reply.send(view);
  });

  app.post('/api/inbox-items/:id/cancellation', async (request, reply) => {
    const { id } = ItemIdParams.parse(request.params);
    const body = CancelItemBody.parse(request.body);
    return reply.send(
      await useCases.cancelInboxItem.execute({
        id: inboxItemId(id), actor: actorFrom(request), reason: body.reason,
      }),
    );
  });
}
```

Every handler is the same four lines: parse, lift primitives into value objects, call one use
case, send. There is nowhere for a rule to hide, and that uniformity is the point — it is what
makes the routes boring enough to review at a glance.

```ts
// src/api/http/routes/healthRoutes.ts
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
```

## 4.6 App factory

```ts
// src/api/http/buildHttpApp.ts
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { UseCases } from '../../composition/container.js';
import { toProblem } from './problemDetails.js';
import { registerHealthRoutes, type HealthDeps } from './routes/healthRoutes.js';
import { registerInboxItemRoutes } from './routes/inboxItemRoutes.js';

export interface HttpAppOptions {
  readonly useCases: UseCases;
  readonly health: HealthDeps;
  readonly logger: unknown;
}

export function buildHttpApp(options: HttpAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger as never,
    // Trust an inbound id so a request can be followed across services; mint one otherwise.
    genReqId: (request) => (request.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    disableRequestLogging: false,
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
  registerInboxItemRoutes(app, options.useCases);
  return app;
}
```

The factory returns an app rather than starting one, so Stage 5's tests can use
`app.inject()` — real routing, real serialisation, real error handler, no sockets.

## 4.7 Composition root

The only file allowed to know both the abstract and the concrete. Every `new` for an adapter
happens here, which is why every other file can be read without asking "which implementation is
this?".

```ts
// src/composition/container.ts
import { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import type { Clock } from '../application/ports/Clock.js';
import type { UnitOfWork } from '../application/ports/UnitOfWork.js';
import { CancelInboxItem } from '../application/use-cases/CancelInboxItem.js';
import { ClaimInboxItem } from '../application/use-cases/ClaimInboxItem.js';
import { CompleteInboxItem } from '../application/use-cases/CompleteInboxItem.js';
import { CreateInboxItem } from '../application/use-cases/CreateInboxItem.js';
import { GetInboxItem } from '../application/use-cases/GetInboxItem.js';
import { ListInboxItems } from '../application/use-cases/ListInboxItems.js';
import { ReleaseInboxItem } from '../application/use-cases/ReleaseInboxItem.js';
import { UuidGenerator } from '../infrastructure/id/UuidGenerator.js';
import { InMemoryStore } from '../infrastructure/persistence/memory/InMemoryInboxItemRepository.js';
import { InMemoryUnitOfWork } from '../infrastructure/persistence/memory/InMemoryUnitOfWork.js';
import { PgUnitOfWork } from '../infrastructure/persistence/pg/PgUnitOfWork.js';
import { SystemClock } from '../infrastructure/time/SystemClock.js';

export interface UseCases {
  readonly createInboxItem: CreateInboxItem;
  readonly listInboxItems: ListInboxItems;
  readonly getInboxItem: GetInboxItem;
  readonly claimInboxItem: ClaimInboxItem;
  readonly releaseInboxItem: ReleaseInboxItem;
  readonly completeInboxItem: CompleteInboxItem;
  readonly cancelInboxItem: CancelInboxItem;
}

export interface Container {
  readonly useCases: UseCases;
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly checkReadiness: () => Promise<void>;
  readonly shutdown: () => Promise<void>;
}

export function buildUseCases(uow: UnitOfWork, clock: Clock): UseCases {
  const ids = new UuidGenerator();
  return {
    createInboxItem: new CreateInboxItem(uow, clock, ids),
    listInboxItems: new ListInboxItems(uow),
    getInboxItem: new GetInboxItem(uow),
    claimInboxItem: new ClaimInboxItem(uow, clock),
    releaseInboxItem: new ReleaseInboxItem(uow, clock),
    completeInboxItem: new CompleteInboxItem(uow, clock),
    cancelInboxItem: new CancelInboxItem(uow, clock),
  };
}

export function buildContainer(config: AppConfig, clock: Clock = new SystemClock()): Container {
  if (config.store === 'postgres') {
    const pool = new Pool({ connectionString: config.databaseUrl!, max: 10 });
    const uow = new PgUnitOfWork(pool);
    return {
      useCases: buildUseCases(uow, clock),
      uow,
      clock,
      checkReadiness: async () => { await pool.query('SELECT 1'); },
      shutdown: () => pool.end(),
    };
  }

  const uow = new InMemoryUnitOfWork(new InMemoryStore());
  return {
    useCases: buildUseCases(uow, clock),
    uow,
    clock,
    checkReadiness: async () => undefined,
    shutdown: async () => undefined,
  };
}
```

No DI framework. Seven use cases and four adapters do not need a container library, and
hand-wiring keeps the dependency graph readable in one screen — the moment that stops being
true is the moment to reconsider, not before.

```ts
// src/composition/seed.ts
import type { UseCases } from './container.js';
import { actorId } from '../domain/inbox/value-objects/ActorId.js';
import { title } from '../domain/inbox/value-objects/Title.js';

/** Demo data for STORE=memory, so `npm run dev` shows a populated inbox immediately. */
export async function seedDemoData(useCases: UseCases): Promise<void> {
  const ana = actorId('ana.silva');
  const items = [
    { kind: 'approve_expense' as const,      t: 'Expense EXP-1042 — $420 travel to Lisbon', p: 'high' as const },
    { kind: 'review_deployment' as const,    t: 'Deploy payments-api v2.14.0 to production', p: 'urgent' as const },
    { kind: 'upload_documentation' as const, t: 'Upload Q3 SOC2 evidence pack',              p: 'normal' as const },
    { kind: 'complete_onboarding' as const,  t: 'Finish onboarding checklist for B. Oyelaran', p: 'low' as const },
  ];

  for (const item of items) {
    await useCases.createInboxItem.execute({
      kind: item.kind, title: title(item.t), assignee: ana, priority: item.p, dueAt: null,
    });
  }
}
```

```ts
// src/main.ts
import { buildHttpApp } from './api/http/buildHttpApp.js';
import { registerWebRoutes } from './api/web/routes/registerWebRoutes.js'; // Stage 6
import { loadConfig } from './config.js';
import { buildContainer } from './composition/container.js';
import { seedDemoData } from './composition/seed.js';
import { createLogger } from './infrastructure/observability/logger.js';      // Stage 5

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
  process.once(signal, async () => {
    logger.info({ signal }, 'shutting down');
    await app.close();          // stop accepting, drain in-flight requests
    await container.shutdown(); // then release the pool
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: '0.0.0.0' });
logger.info({ port: config.port, store: config.store }, 'workflow inbox listening');
```

Shutdown order matters and is easy to get backwards: close the server *first* so in-flight
requests finish against a live pool, then close the pool. Reversed, a rolling deploy produces a
handful of 500s on every restart.

## 4.8 Exercising it

```bash
npm run dev

# List the seeded inbox
curl -s localhost:3000/api/inbox-items | jq '.items[] | {id, title, status, availableActions}'

# Approve one — twice, with the SAME key: the second call is a no-op success
ID=$(curl -s localhost:3000/api/inbox-items | jq -r '.items[0].id')
for i in 1 2; do
  curl -s -X POST localhost:3000/api/inbox-items/$ID/completion \
    -H 'content-type: application/json' \
    -H 'x-actor-id: ana.silva' \
    -H 'idempotency-key: demo-key-0001' \
    -d '{"outcome":"approved"}' | jq '{status, version, completion}'
done

# A DIFFERENT key on the same item is a 409, not a silent second approval
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/inbox-items/$ID/completion \
  -H 'content-type: application/json' -H 'x-actor-id: ana.silva' \
  -H 'idempotency-key: demo-key-0002' -d '{"outcome":"approved"}'   # → 409

# Rejecting an expense without a note is a 422 with an actionable message
curl -s -X POST localhost:3000/api/inbox-items/$ID/completion \
  -H 'content-type: application/json' -H 'x-actor-id: ana.silva' \
  -H 'idempotency-key: demo-key-0003' -d '{"outcome":"rejected"}' | jq
```

The first block is the demo to run in the screen recording: same key twice → identical body,
version unchanged, no duplicate event; different key → 409.

## What this stage proves

- The API is a translation layer, verifiably: no `if` in a route touches business state.
- Failure responses are typed, correlated, and safe (no internals leak on a 500).
- The whole app boots with zero infrastructure, so review friction is near zero.

## Verify

```bash
npm run typecheck && npm run lint
npm run openapi:check
npm run test:all
```

Next: [Stage 5 — observability and tests](06-stage-5-observability-and-tests.md).
