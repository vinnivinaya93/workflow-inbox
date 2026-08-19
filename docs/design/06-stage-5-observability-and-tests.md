# Stage 5 — Observability and Tests

> **Goal:** make the service explainable at 3am, and prove the behaviour at every level of the
> hexagon with the cheapest test that can fail for the right reason.
> **In the hour:** request IDs + structured logging, yes (~5 min). Metrics, the Testcontainers
> suite and the concurrency test are **post-hour** — written up because "observability" and
> "how do you know it works?" are the two questions this exercise is really asking.

## Files added

```
src/infrastructure/observability/logger.ts
src/infrastructure/observability/metrics.ts
src/infrastructure/observability/MeteredEventPublisher.ts
src/api/http/routes/metricsRoutes.ts
vitest.config.ts
test/support/{fixtures.ts,testContainer.ts}
test/unit/application/CompleteInboxItem.spec.ts
test/integration/http/inboxApi.spec.ts
test/integration/pg/PgInboxItemRepository.spec.ts
```

---

## 5.1 Logging

```ts
// src/infrastructure/observability/logger.ts
import pino, { type Logger } from 'pino';

export function createLogger(level: string): Logger {
  return pino({
    level,
    // One field name for correlation everywhere: log lines, response header, problem+json.
    formatters: { level: (label) => ({ level: label }) },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-actor-id"]', // an actor handle is personal data; the item id is enough
      ],
      censor: '[redacted]',
    },
    ...(process.env.NODE_ENV !== 'production'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l' } } }
      : {}),
  });
}
```

Two decisions worth defending:

- **`x-actor-id` is redacted.** Who approved what is in the audit record (`completion.by`), which
  is the right home for it. Logs get shipped, sampled and retained by different rules; putting
  identities in them creates a data-protection obligation for no operational gain.
- **Rejections log at `info`, not `error`** (see Stage 4's error handler). A 409 from a
  double-click is the system working. Logging it as an error trains everyone to ignore errors,
  which is how the real one gets missed.

## 5.2 Metrics

Four series, chosen so each one answers a question someone will actually ask.

```ts
// src/infrastructure/observability/metrics.ts
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

/** "Is the API healthy and fast?" — buckets sized for a human-facing internal tool. */
export const httpDuration = new Histogram({
  name: 'http_server_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

/** "How much work are operators actually clearing, and how?" */
export const completions = new Counter({
  name: 'inbox_items_completed_total',
  help: 'Inbox items completed, by kind and outcome',
  labelNames: ['kind', 'outcome'] as const,
  registers: [registry],
});

/** "Are we losing races?" A rising rate means contention worth investigating. */
export const conflicts = new Counter({
  name: 'inbox_conflicts_total',
  help: 'Rejected writes, by reason',
  labelNames: ['code'] as const,
  registers: [registry],
});

/** "Are downstream services hearing about outcomes?" The one that pages someone. */
export const outboxBacklog = new Counter({
  name: 'outbox_events_enqueued_total',
  help: 'Domain events written to the outbox, by name',
  labelNames: ['name'] as const,
  registers: [registry],
});
```

Label cardinality is bounded on purpose: `route` is the Fastify route *pattern*
(`/api/inbox-items/:id/completion`), never the resolved URL, and `kind`/`outcome` come from
closed enums. An unbounded label is how a metrics backend gets taken down by its own client.

```ts
// src/infrastructure/observability/MeteredEventPublisher.ts
import type { EventPublisher } from '../../application/ports/EventPublisher.js';
import type { DomainEvent } from '../../domain/shared/DomainEvent.js';
import { INBOX_EVENTS } from '../../domain/inbox/events.js';
import { completions, outboxBacklog } from './metrics.js';

/**
 * Business metrics derive from domain events, not from HTTP handlers.
 * Consequence: the HTML UI in Stage 6 is measured identically to the JSON API, for free, and a
 * replayed (no-op) completion is correctly *not* counted — because it emits no event.
 */
export class MeteredEventPublisher implements EventPublisher {
  constructor(private readonly inner: EventPublisher) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    await this.inner.publish(events);
    for (const event of events) {
      outboxBacklog.inc({ name: event.name });
      if (event.name === INBOX_EVENTS.completed) {
        const p = event.payload as { kind: string; outcome: string };
        completions.inc({ kind: p.kind, outcome: p.outcome });
      }
    }
  }
}
```

Wiring it is a one-line change to the unit-of-work adapters, which is the payoff for having made
the publisher a port:

```ts
// src/infrastructure/persistence/pg/PgUnitOfWork.ts  (delta)
export class PgUnitOfWork implements UnitOfWork {
  constructor(
    private readonly pool: Pool,
    private readonly decorate: (p: EventPublisher) => EventPublisher = (p) => p,
  ) {}
  // …
  events: this.decorate(new OutboxEventPublisher(client)),
}

// src/composition/container.ts  (delta)
const uow = new PgUnitOfWork(pool, (p) => new MeteredEventPublisher(p));
```

```ts
// src/api/http/routes/metricsRoutes.ts
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
```

## 5.3 Test strategy

One rule: **test each behaviour at the cheapest layer that can prove it, and only once.**

| Layer | What it owns | Cost | Count here |
| --- | --- | --- | --- |
| Domain unit (Stage 1) | Every invariant and transition | µs, no I/O | ~11 |
| Use-case unit | Orchestration: transactions, event publication, idempotent skip | ms, in-memory adapters | ~6 |
| Pg integration | Mapping, SQL, optimistic concurrency, keyset paging | seconds, Testcontainers | ~5 |
| HTTP integration | Status codes, problem+json, header handling | ms, `app.inject()` | ~7 |

There are no mocking-library doubles anywhere. The in-memory adapters *are* the doubles, they
implement the same ports as production, and Stage 3's integration tests keep them honest — which
is the difference between a test suite that catches regressions and one that asserts the mocks
were called.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,      // Testcontainers pulls an image on a cold machine
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // The domain is where coverage means something; adapters are covered by integration tests.
      thresholds: { 'src/domain/**': { statements: 95, branches: 90 } },
    },
  },
});
```

```ts
// test/support/fixtures.ts
import { InMemoryStore } from '../../src/infrastructure/persistence/memory/InMemoryInboxItemRepository.js';
import { InMemoryUnitOfWork } from '../../src/infrastructure/persistence/memory/InMemoryUnitOfWork.js';
import { FixedClock } from '../../src/infrastructure/time/SystemClock.js';
import { buildUseCases, type UseCases } from '../../src/composition/container.js';
import type { DomainEvent } from '../../src/domain/shared/DomainEvent.js';

export interface Harness {
  readonly useCases: UseCases;
  readonly clock: FixedClock;
  readonly published: DomainEvent[];
  readonly store: InMemoryStore;
}

export function harness(at = new Date('2026-08-18T09:00:00.000Z')): Harness {
  const store = new InMemoryStore();
  const published: DomainEvent[] = [];
  const uow = new InMemoryUnitOfWork(store, published);
  const clock = new FixedClock(at);
  return { useCases: buildUseCases(uow, clock), clock, published, store };
}
```

## 5.4 Use-case tests

```ts
// test/unit/application/CompleteInboxItem.spec.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { harness, type Harness } from '../../support/fixtures.js';
import { ItemNotFound } from '../../../src/application/errors.js';
import { CompletionConflict } from '../../../src/domain/inbox/errors.js';
import { actorId } from '../../../src/domain/inbox/value-objects/ActorId.js';
import { idempotencyKey } from '../../../src/domain/inbox/value-objects/IdempotencyKey.js';
import { inboxItemId } from '../../../src/domain/inbox/value-objects/InboxItemId.js';
import { outcome } from '../../../src/domain/inbox/value-objects/Outcome.js';
import { title } from '../../../src/domain/inbox/value-objects/Title.js';

const ANA = actorId('ana.silva');
const KEY = idempotencyKey('form-attempt-1');

describe('CompleteInboxItem', () => {
  let h: Harness;

  beforeEach(async () => {
    h = harness();
  });

  const anItem = () =>
    h.useCases.createInboxItem.execute({
      kind: 'approve_expense',
      title: title('Expense EXP-1042'),
      assignee: ANA,
      priority: 'normal',
      dueAt: null,
    });

  it('completes, versions and publishes exactly one completed event', async () => {
    const created = await anItem();
    h.published.length = 0;

    const view = await h.useCases.completeInboxItem.execute({
      id: inboxItemId(created.id), actor: ANA, outcome: outcome('approved'), note: null, idempotencyKey: KEY,
    });

    expect(view.status).toBe('completed');
    expect(view.version).toBe(2);                     // auto-claim + complete
    expect(view.availableActions).toEqual([]);
    expect(h.published.map((e) => e.name)).toEqual([
      'inbox.item.claimed', 'inbox.item.completed',
    ]);
    // The version the caller was told matches what is stored — no stale-version trap.
    expect(h.store.rows.get(created.id)?.version).toBe(2);
  });

  it('replays a completion without writing or publishing anything', async () => {
    const created = await anItem();
    await h.useCases.completeInboxItem.execute({
      id: inboxItemId(created.id), actor: ANA, outcome: outcome('approved'), note: null, idempotencyKey: KEY,
    });
    const stored = { ...h.store.rows.get(created.id)! };
    h.published.length = 0;
    h.clock.advanceBy(60_000);

    const view = await h.useCases.completeInboxItem.execute({
      id: inboxItemId(created.id), actor: ANA, outcome: outcome('approved'), note: null, idempotencyKey: KEY,
    });

    expect(h.published).toEqual([]);                        // no duplicate notification
    expect(h.store.rows.get(created.id)).toEqual(stored);   // byte-identical row, updatedAt untouched
    expect(view.completion?.at).toBe(stored.completion?.at.toISOString());
  });

  it('rolls the transaction back when the domain refuses', async () => {
    const created = await anItem();
    const before = { ...h.store.rows.get(created.id)! };
    h.published.length = 0;

    await h.useCases.completeInboxItem.execute({
      id: inboxItemId(created.id), actor: ANA, outcome: outcome('approved'), note: null, idempotencyKey: KEY,
    });
    h.published.length = 0;
    const afterFirst = { ...h.store.rows.get(created.id)! };

    await expect(
      h.useCases.completeInboxItem.execute({
        id: inboxItemId(created.id), actor: ANA, outcome: outcome('rejected'),
        note: null, idempotencyKey: idempotencyKey('form-attempt-2'),
      }),
    ).rejects.toThrow(CompletionConflict);

    expect(h.store.rows.get(created.id)).toEqual(afterFirst); // first outcome intact
    expect(h.published).toEqual([]);
    expect(before.status).toBe('pending');
  });

  it('404s on an unknown id', async () => {
    await expect(
      h.useCases.completeInboxItem.execute({
        id: inboxItemId('00000000-0000-4000-8000-000000000000'),
        actor: ANA, outcome: outcome('approved'), note: null, idempotencyKey: KEY,
      }),
    ).rejects.toThrow(ItemNotFound);
  });
});
```

## 5.5 HTTP integration tests

```ts
// test/integration/http/inboxApi.spec.ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildHttpApp } from '../../../src/api/http/buildHttpApp.js';
import { harness } from '../../support/fixtures.js';

function appFor(useCases: Parameters<typeof buildHttpApp>[0]['useCases']): FastifyInstance {
  return buildHttpApp({
    useCases,
    health: { checkReadiness: async () => undefined, version: 'test' },
    logger: false,
  });
}

const CREATE = {
  method: 'POST' as const,
  url: '/api/inbox-items',
  payload: { kind: 'approve_expense', title: 'Expense EXP-1042', assignee: 'ana.silva' },
};

describe('inbox HTTP API', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = appFor(harness().useCases);
  });

  const created = async () => (await app.inject(CREATE)).json<{ id: string }>();

  it('creates with 201 and a Location header', async () => {
    const response = await app.inject(CREATE);
    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toMatch(/^\/api\/inbox-items\/[0-9a-f-]{36}$/);
    expect(response.json()).toMatchObject({ status: 'pending', priority: 'normal' });
  });

  it('returns field-level problem+json on a malformed body', async () => {
    const response = await app.inject({ ...CREATE, payload: { kind: 'nope', title: '' } });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    const problem = response.json();
    expect(problem.code).toBe('REQUEST_VALIDATION_ERROR');
    expect(problem.errors.map((e: { field: string }) => e.field)).toContain('kind');
    expect(problem.requestId).toBeTruthy();
  });

  it('requires the Idempotency-Key header to complete', async () => {
    const { id } = await created();
    const response = await app.inject({
      method: 'POST',
      url: `/api/inbox-items/${id}/completion`,
      headers: { 'x-actor-id': 'ana.silva' },
      payload: { outcome: 'approved' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('is idempotent across identical requests and 409s on a new key', async () => {
    const { id } = await created();
    const complete = (key: string) =>
      app.inject({
        method: 'POST',
        url: `/api/inbox-items/${id}/completion`,
        headers: { 'x-actor-id': 'ana.silva', 'idempotency-key': key },
        payload: { outcome: 'approved' },
      });

    const first = await complete('form-abc-123');
    const replay = await complete('form-abc-123');
    const second = await complete('form-xyz-789');

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());   // identical body, including version
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('ITEM_COMPLETION_CONFLICT');
  });

  it('403s when someone else holds the item', async () => {
    const { id } = await created();
    await app.inject({ method: 'POST', url: `/api/inbox-items/${id}/claim`, headers: { 'x-actor-id': 'ana.silva' } });
    const response = await app.inject({
      method: 'POST',
      url: `/api/inbox-items/${id}/completion`,
      headers: { 'x-actor-id': 'ben.oyelaran', 'idempotency-key': 'form-other-1' },
      payload: { outcome: 'approved' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('ITEM_NOT_ASSIGNED_TO_ACTOR');
  });

  it('422s with an actionable message when the outcome breaks the kind policy', async () => {
    const { id } = await created();
    const response = await app.inject({
      method: 'POST',
      url: `/api/inbox-items/${id}/completion`,
      headers: { 'x-actor-id': 'ana.silva', 'idempotency-key': 'form-reject-1' },
      payload: { outcome: 'rejected' },                    // no note
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().detail).toContain('a note is required');
  });

  it('echoes an inbound x-request-id for cross-service correlation', async () => {
    const response = await app.inject({ ...CREATE, headers: { 'x-request-id': 'trace-42' } });
    expect(response.headers['x-request-id']).toBe('trace-42');
  });
});
```

## 5.6 PostgreSQL integration tests

```ts
// test/support/testContainer.ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

export interface PgHarness {
  readonly pool: Pool;
  readonly stop: () => Promise<void>;
  readonly truncate: () => Promise<void>;
}

export async function startPostgres(): Promise<PgHarness> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
  const pool = new Pool({ connectionString: container.getConnectionUri(), max: 5 });

  // Same migration file production runs — the schema under test is never a test-only copy.
  await pool.query(readFileSync(new URL('../../migrations/001_init.sql', import.meta.url), 'utf8'));

  return {
    pool,
    truncate: async () => { await pool.query('TRUNCATE inbox_item, outbox_event'); },
    stop: async () => { await pool.end(); await container.stop(); },
  };
}
```

```ts
// test/integration/pg/PgInboxItemRepository.spec.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyConflict } from '../../../src/application/errors.js';
import { buildUseCases } from '../../../src/composition/container.js';
import { PgUnitOfWork } from '../../../src/infrastructure/persistence/pg/PgUnitOfWork.js';
import { FixedClock } from '../../../src/infrastructure/time/SystemClock.js';
import { actorId } from '../../../src/domain/inbox/value-objects/ActorId.js';
import { completionNote } from '../../../src/domain/inbox/value-objects/CompletionNote.js';
import { idempotencyKey } from '../../../src/domain/inbox/value-objects/IdempotencyKey.js';
import { inboxItemId } from '../../../src/domain/inbox/value-objects/InboxItemId.js';
import { outcome } from '../../../src/domain/inbox/value-objects/Outcome.js';
import { title } from '../../../src/domain/inbox/value-objects/Title.js';
import { startPostgres, type PgHarness } from '../../support/testContainer.js';

const ANA = actorId('ana.silva');

describe('PostgreSQL adapter', () => {
  let pg: PgHarness;
  let useCases: ReturnType<typeof buildUseCases>;
  let clock: FixedClock;

  beforeAll(async () => {
    pg = await startPostgres();
    clock = new FixedClock(new Date('2026-08-18T09:00:00.000Z'));
    useCases = buildUseCases(new PgUnitOfWork(pg.pool), clock);
  });
  afterAll(async () => pg.stop());
  beforeEach(async () => pg.truncate());

  const create = (t: string) =>
    useCases.createInboxItem.execute({
      kind: 'approve_expense', title: title(t), assignee: ANA, priority: 'normal', dueAt: null,
    });

  it('round-trips every field through the mapper without loss', async () => {
    const created = await create('Expense EXP-1042 — $420');
    await useCases.completeInboxItem.execute({
      id: inboxItemId(created.id), actor: ANA, outcome: outcome('rejected'),
      note: completionNote('receipt missing'), idempotencyKey: idempotencyKey('key-round-trip'),
    });

    const reloaded = await useCases.getInboxItem.execute(inboxItemId(created.id));
    expect(reloaded).toMatchObject({
      status: 'completed', version: 2,
      completion: { outcome: 'rejected', note: 'receipt missing', by: 'ana.silva' },
    });
  });

  it('writes the completion and its outbox event in one transaction', async () => {
    const created = await create('Expense EXP-2001');
    await useCases.completeInboxItem.execute({
      id: inboxItemId(created.id), actor: ANA, outcome: outcome('approved'),
      note: null, idempotencyKey: idempotencyKey('key-outbox-1'),
    });

    const { rows } = await pg.pool.query<{ name: string }>('SELECT name FROM outbox_event ORDER BY id');
    expect(rows.map((r) => r.name)).toEqual(['inbox.item.created', 'inbox.item.claimed', 'inbox.item.completed']);
  });

  it('lets exactly one of two racing completions win', async () => {
    const created = await create('Expense EXP-3003');
    const attempt = (key: string) =>
      useCases.completeInboxItem.execute({
        id: inboxItemId(created.id), actor: ANA, outcome: outcome('approved'),
        note: null, idempotencyKey: idempotencyKey(key),
      });

    const results = await Promise.allSettled([attempt('key-race-a'), attempt('key-race-b')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const { rows } = await pg.pool.query<{ c: string }>(
      `SELECT count(*) AS c FROM outbox_event WHERE name = 'inbox.item.completed'`,
    );
    expect(rows[0]?.c).toBe('1'); // never two approvals, whichever way the race resolved
  });

  it('pages by keyset without skipping or repeating under concurrent inserts', async () => {
    for (let i = 0; i < 5; i += 1) {
      await create(`Expense ${i}`);
      clock.advanceBy(1000); // distinct created_at values
    }

    const first = await useCases.listInboxItems.execute({ limit: 2 });
    await create('Arrived mid-pagination');           // would shift an OFFSET query
    const second = await useCases.listInboxItems.execute({ limit: 2, cursor: first.nextCursor! });

    const ids = [...first.items, ...second.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(4);
    expect(second.items.map((i) => i.title)).not.toContain('Arrived mid-pagination');
  });

  it('rejects a stale write with ConcurrencyConflict', async () => {
    const created = await create('Expense EXP-4004');
    const uow = new PgUnitOfWork(pg.pool);

    await expect(
      uow.transaction(async (ctx) => {
        const a = await ctx.inboxItems.findById(inboxItemId(created.id));
        const b = await ctx.inboxItems.findById(inboxItemId(created.id)); // same version
        a!.claim(ANA, clock.now());
        b!.cancel(ANA, 'withdrawn', clock.now());
        await ctx.inboxItems.update(a!);
        await ctx.inboxItems.update(b!); // ← loses
      }),
    ).rejects.toThrow(ConcurrencyConflict);
  });
});
```

The racing-completions test is the one that earns its runtime. It asserts the property that
matters — *an item is approved at most once, no matter how the race resolves* — rather than the
mechanism, so it will still be valid if the locking strategy changes.

## 5.7 Runbook extract

Shipped in the repo as `docs/runbook.md`; the essentials:

| Symptom | First look | Likely cause | Action |
| --- | --- | --- | --- |
| `inbox_conflicts_total{code="http_409"}` climbing | Logs filtered to `ITEM_COMPLETION_CONFLICT` | A client retrying with a fresh key per attempt | Client bug: the key must be minted per *intent*, not per request |
| `/readyz` failing, `/healthz` fine | `SELECT 1` latency, pool saturation | Database or connectivity | Do not restart the app; it is deliberately not self-inflicted |
| `outbox_events_enqueued_total` rising, consumers quiet | `SELECT count(*) FROM outbox_event WHERE published_at IS NULL` | Drainer stopped | Restart the drainer; delivery is at-least-once, so replays are safe |
| Operator: "my approval vanished" | `SELECT * FROM outbox_event WHERE aggregate_id = …` then the item row | Almost always a 409 the UI surfaced badly | Read `completion.by`/`at`; the audit record is authoritative |
| p99 latency up, DB fine | `http_server_request_duration_seconds` by `route` | Unbounded page size or a missing index | Check `limit`; `EXPLAIN` the list query against `inbox_item_page_idx` |

## What this stage proves

- Every request is traceable end to end by one id that appears in the log, the response header
  and the error body.
- Business metrics come from domain events, so they are adapter-agnostic and cannot count a
  replayed no-op.
- The most dangerous property in the system — at-most-once completion — is asserted under real
  concurrency against real PostgreSQL.

## Verify

```bash
npm run test:all
npx vitest run --coverage      # domain thresholds enforced
```

Next: [Stage 6 — the accessible UI](07-stage-6-accessible-ui.md).
