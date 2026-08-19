# Stage 3 — Infrastructure (Driven Adapters)

> **Goal:** satisfy the five ports twice — once in memory so the app runs and tests fly, once on
> PostgreSQL so it is real. Neither implementation may leak into the layers above.
> **In the hour:** the in-memory adapter, yes (~5 min). PostgreSQL, the mapper, the outbox and
> the migration runner are **post-hour work**, included because the ports were designed for
> exactly this swap and the interview conversation is about what happens next.

## Files added

```
src/infrastructure/time/SystemClock.ts
src/infrastructure/id/UuidGenerator.ts
src/infrastructure/persistence/memory/{InMemoryInboxItemRepository,InMemoryUnitOfWork,RecordingEventPublisher}.ts
src/infrastructure/persistence/pg/{cursor,inboxItemMapper,PgInboxItemRepository,PgUnitOfWork,OutboxEventPublisher}.ts
migrations/001_init.sql
scripts/migrate.ts
```

---

## 3.1 The trivial two

```ts
// src/infrastructure/time/SystemClock.ts
import type { Clock } from '../../application/ports/Clock.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Tests inject this instead of mocking global time. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return this.current; }
  advanceBy(ms: number): void { this.current = new Date(this.current.getTime() + ms); }
  set(at: Date): void { this.current = at; }
}
```

```ts
// src/infrastructure/id/UuidGenerator.ts
import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../../application/ports/IdGenerator.js';
import { inboxItemId, type InboxItemId } from '../../domain/inbox/value-objects/InboxItemId.js';

export class UuidGenerator implements IdGenerator {
  newInboxItemId(): InboxItemId {
    return inboxItemId(randomUUID());
  }
}
```

`FixedClock` living beside the real clock is deliberate: the test double is an *adapter*, not a
mock library trick, so it is typed against the same port and can never drift from it.

## 3.2 In-memory adapter — the default runtime

This is not "just for tests". `STORE=memory` is the default so a reviewer can `npm install &&
npm run dev` and click through the UI with no Docker, no Postgres, no migrations. That decision
is why it implements the same optimistic-concurrency contract as the real one instead of being a
loose `Map`.

```ts
// src/infrastructure/persistence/memory/InMemoryInboxItemRepository.ts
import { ConcurrencyConflict } from '../../../application/errors.js';
import type {
  InboxItemFilter, InboxItemRepository, Page, PageRequest,
} from '../../../application/ports/InboxItemRepository.js';
import { InboxItem, type InboxItemState } from '../../../domain/inbox/InboxItem.js';
import type { InboxItemId } from '../../../domain/inbox/value-objects/InboxItemId.js';

/** Shared store so every transaction in a process sees the same data. */
export class InMemoryStore {
  readonly rows = new Map<string, InboxItemState>();

  snapshot(): Map<string, InboxItemState> { return new Map(this.rows); }
  restore(rows: Map<string, InboxItemState>): void {
    this.rows.clear();
    for (const [k, v] of rows) this.rows.set(k, v);
  }
}

export class InMemoryInboxItemRepository implements InboxItemRepository {
  constructor(private readonly store: InMemoryStore) {}

  async findById(id: InboxItemId): Promise<InboxItem | null> {
    const row = this.store.rows.get(id);
    return row ? InboxItem.rehydrate(structuredClone(row)) : null;
  }

  async insert(item: InboxItem): Promise<void> {
    const state = item.snapshot();
    if (this.store.rows.has(state.id)) {
      throw new ConcurrencyConflict(state.id, state.version);
    }
    this.store.rows.set(state.id, structuredClone(state));
  }

  async update(item: InboxItem): Promise<void> {
    const state = item.snapshot();
    const current = this.store.rows.get(state.id);
    if (!current || current.version !== item.persistedVersion) {
      throw new ConcurrencyConflict(state.id, item.persistedVersion);
    }
    this.store.rows.set(state.id, structuredClone(state));
  }

  async search(filter: InboxItemFilter, page: PageRequest): Promise<Page<InboxItem>> {
    // Same ordering contract as the SQL adapter: newest first, id as the tiebreaker.
    const ordered = [...this.store.rows.values()]
      .filter((r) => (filter.statuses ? filter.statuses.includes(r.status) : true))
      .filter((r) => (filter.assignee ? r.assignee === filter.assignee : true))
      .filter((r) => (filter.kinds ? filter.kinds.includes(r.kind) : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));

    const start = page.cursor ? ordered.findIndex((r) => cursorOf(r) === page.cursor) + 1 : 0;
    const slice = ordered.slice(start, start + page.limit);
    const last = slice.at(-1);
    const more = start + page.limit < ordered.length;

    return {
      items: slice.map((r) => InboxItem.rehydrate(structuredClone(r))),
      nextCursor: more && last ? cursorOf(last) : null,
    };
  }
}

const cursorOf = (r: InboxItemState) => `${r.createdAt.toISOString()}|${r.id}`;
```

`structuredClone` on the way in *and* out is the point of care here: without it a caller holding
an `InboxItemState` could mutate stored data and the in-memory adapter would be more permissive
than Postgres, which is the classic way an in-memory double stops being a useful signal.

```ts
// src/infrastructure/persistence/memory/InMemoryUnitOfWork.ts
import type { TransactionContext, UnitOfWork } from '../../../application/ports/UnitOfWork.js';
import type { DomainEvent } from '../../../domain/shared/DomainEvent.js';
import { InMemoryInboxItemRepository, InMemoryStore } from './InMemoryInboxItemRepository.js';
import { RecordingEventPublisher } from './RecordingEventPublisher.js';

export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(
    private readonly store: InMemoryStore = new InMemoryStore(),
    readonly published: DomainEvent[] = [],
  ) {}

  async transaction<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    const before = this.store.snapshot();
    const staged: DomainEvent[] = [];
    const ctx: TransactionContext = {
      inboxItems: new InMemoryInboxItemRepository(this.store),
      events: new RecordingEventPublisher(staged),
    };

    try {
      const result = await work(ctx);
      this.published.push(...staged);   // commit: events become visible with the state
      return result;
    } catch (error) {
      this.store.restore(before);       // rollback, including the staged events
      throw error;
    }
  }
}
```

Copy-on-begin / restore-on-throw gives real rollback semantics. It costs a map copy per
transaction and would be wrong for large datasets — acceptable and documented, because the
alternative (an in-memory adapter that silently keeps partial writes) would make every use-case
test lie about atomicity.

```ts
// src/infrastructure/persistence/memory/RecordingEventPublisher.ts
import type { EventPublisher } from '../../../application/ports/EventPublisher.js';
import type { DomainEvent } from '../../../domain/shared/DomainEvent.js';

export class RecordingEventPublisher implements EventPublisher {
  constructor(private readonly sink: DomainEvent[]) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    this.sink.push(...events);
  }
}
```

## 3.3 Schema

Text + `CHECK` rather than PostgreSQL `ENUM`: adding `revoke_access` later is then one
`ALTER … DROP/ADD CONSTRAINT` in a migration instead of `ALTER TYPE`, which is awkward inside a
transaction on older servers. The domain remains the real source of truth for the value set; the
constraint is a safety net against a bad backfill, not the definition.

```sql
-- migrations/001_init.sql
CREATE TABLE IF NOT EXISTS inbox_item (
  id                UUID        PRIMARY KEY,
  kind              TEXT        NOT NULL
                      CHECK (kind IN ('approve_expense','review_deployment',
                                      'upload_documentation','complete_onboarding')),
  title             TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
  assignee          TEXT        NOT NULL,
  priority          TEXT        NOT NULL CHECK (priority IN ('low','normal','high','urgent')),
  due_at            TIMESTAMPTZ,
  status            TEXT        NOT NULL
                      CHECK (status IN ('pending','claimed','completed','cancelled')),
  claimed_by        TEXT,
  claimed_at        TIMESTAMPTZ,
  outcome           TEXT        CHECK (outcome IN ('approved','rejected','done')),
  completion_note   TEXT,
  completed_by      TEXT,
  completed_at      TIMESTAMPTZ,
  idempotency_key   TEXT,
  cancel_reason     TEXT,
  cancelled_by      TEXT,
  cancelled_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL,
  version           INTEGER     NOT NULL DEFAULT 0,

  -- The database refuses to hold a shape the aggregate cannot produce.
  CONSTRAINT completed_items_are_complete CHECK (
    (status <> 'completed')
    OR (outcome IS NOT NULL AND completed_by IS NOT NULL
        AND completed_at IS NOT NULL AND idempotency_key IS NOT NULL)
  ),
  CONSTRAINT claimed_items_have_a_claimer CHECK (
    (status <> 'claimed') OR (claimed_by IS NOT NULL AND claimed_at IS NOT NULL)
  ),
  CONSTRAINT cancelled_items_have_a_reason CHECK (
    (status <> 'cancelled') OR (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL)
  )
);

-- Serves the keyset page order, and the inbox's dominant query ("my open work").
CREATE INDEX IF NOT EXISTS inbox_item_page_idx    ON inbox_item (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS inbox_item_open_idx    ON inbox_item (assignee, created_at DESC)
  WHERE status IN ('pending','claimed');

CREATE TABLE IF NOT EXISTS outbox_event (
  id            BIGSERIAL   PRIMARY KEY,
  aggregate_id  UUID        NOT NULL,
  name          TEXT        NOT NULL,
  payload       JSONB       NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  published_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON outbox_event (id)
  WHERE published_at IS NULL;
```

The three `CHECK`s are the honest ones: they mirror aggregate invariants that no amount of
application-level care can guarantee against a hand-written `UPDATE` at 3am.

```ts
// scripts/migrate.ts — deliberately ~30 lines, not a framework
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

const DIR = new URL('../migrations/', import.meta.url).pathname;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migration (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const applied = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migration')).rows.map((r) => r.name),
    );
    const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migration (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`applied ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

await main();
```

Rolling my own migration runner is a *tradeoff, not a preference*: one file with no dependency
beats adding a migration framework for one table, and it is trivially replaceable. If this
outlived the exercise I would move to a real tool before the second migration, because
down-migrations, advisory locks and concurrent deploys are where hand-rolled runners bite.

## 3.4 Mapper — the only place that knows both shapes

```ts
// src/infrastructure/persistence/pg/inboxItemMapper.ts
import { InboxItem, type InboxItemState } from '../../../domain/inbox/InboxItem.js';
import { actorId } from '../../../domain/inbox/value-objects/ActorId.js';
import { completionNote } from '../../../domain/inbox/value-objects/CompletionNote.js';
import { idempotencyKey } from '../../../domain/inbox/value-objects/IdempotencyKey.js';
import { inboxItemId } from '../../../domain/inbox/value-objects/InboxItemId.js';
import { itemKind } from '../../../domain/inbox/value-objects/ItemKind.js';
import type { ItemStatus } from '../../../domain/inbox/value-objects/ItemStatus.js';
import { outcome } from '../../../domain/inbox/value-objects/Outcome.js';
import { priority } from '../../../domain/inbox/value-objects/Priority.js';
import { title } from '../../../domain/inbox/value-objects/Title.js';

export interface InboxItemRow {
  id: string; kind: string; title: string; assignee: string; priority: string;
  due_at: Date | null; status: string;
  claimed_by: string | null; claimed_at: Date | null;
  outcome: string | null; completion_note: string | null;
  completed_by: string | null; completed_at: Date | null; idempotency_key: string | null;
  cancel_reason: string | null; cancelled_by: string | null; cancelled_at: Date | null;
  created_at: Date; updated_at: Date; version: number;
}

export const INBOX_ITEM_COLUMNS = `
  id, kind, title, assignee, priority, due_at, status,
  claimed_by, claimed_at, outcome, completion_note, completed_by, completed_at, idempotency_key,
  cancel_reason, cancelled_by, cancelled_at, created_at, updated_at, version
`;

/**
 * Rows go back through the value-object factories rather than being cast. It costs a few
 * microseconds and means corrupt data fails loudly at the boundary instead of becoming an
 * aggregate that violates its own invariants.
 */
export function toDomain(row: InboxItemRow): InboxItem {
  const state: InboxItemState = {
    id: inboxItemId(row.id),
    kind: itemKind(row.kind),
    title: title(row.title),
    assignee: actorId(row.assignee),
    priority: priority(row.priority),
    dueAt: row.due_at,
    status: row.status as ItemStatus,
    claimedBy: row.claimed_by ? actorId(row.claimed_by) : null,
    claimedAt: row.claimed_at,
    completion:
      row.outcome && row.completed_by && row.completed_at && row.idempotency_key
        ? {
            outcome: outcome(row.outcome),
            note: row.completion_note ? completionNote(row.completion_note) : null,
            by: actorId(row.completed_by),
            at: row.completed_at,
            idempotencyKey: idempotencyKey(row.idempotency_key),
          }
        : null,
    cancellation:
      row.cancelled_by && row.cancelled_at
        ? { reason: row.cancel_reason ?? 'no reason given', by: actorId(row.cancelled_by), at: row.cancelled_at }
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
  return InboxItem.rehydrate(state);
}

/** Ordered to match the parameter lists in the repository's INSERT and UPDATE. */
export function toParams(item: InboxItem): unknown[] {
  const s = item.snapshot();
  return [
    s.id, s.kind, s.title, s.assignee, s.priority, s.dueAt, s.status,
    s.claimedBy, s.claimedAt,
    s.completion?.outcome ?? null, s.completion?.note ?? null,
    s.completion?.by ?? null, s.completion?.at ?? null, s.completion?.idempotencyKey ?? null,
    s.cancellation?.reason ?? null, s.cancellation?.by ?? null, s.cancellation?.at ?? null,
    s.createdAt, s.updatedAt, s.version,
  ];
}
```

## 3.5 Cursor

```ts
// src/infrastructure/persistence/pg/cursor.ts
import { InvalidCursor } from '../../../application/errors.js';

export interface Keyset {
  readonly createdAt: Date;
  readonly id: string;
}

export function encodeCursor(k: Keyset): string {
  return Buffer.from(`${k.createdAt.toISOString()}|${k.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Keyset {
  const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const createdAt = iso ? new Date(iso) : new Date(NaN);
  if (!id || Number.isNaN(createdAt.getTime())) throw new InvalidCursor(raw);
  return { createdAt, id };
}
```

Base64url so the cursor survives a query string untouched, and opaque so clients cannot build
one by hand and pin us to `created_at` forever.

## 3.6 PostgreSQL repository and unit of work

```ts
// src/infrastructure/persistence/pg/PgUnitOfWork.ts
import type { Pool, PoolClient } from 'pg';
import type { TransactionContext, UnitOfWork } from '../../../application/ports/UnitOfWork.js';
import { OutboxEventPublisher } from './OutboxEventPublisher.js';
import { PgInboxItemRepository } from './PgInboxItemRepository.js';

export class PgUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const ctx: TransactionContext = {
        inboxItems: new PgInboxItemRepository(client),
        events: new OutboxEventPublisher(client),
      };
      const result = await work(ctx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined); // never mask the original error
      throw error;
    } finally {
      client.release();
    }
  }
}
```

The repository takes a `PoolClient`, never the `Pool`. That single type choice makes it
*impossible* to run a repository call outside the transaction — the failure mode where an
"atomic" use case quietly uses two connections cannot compile.

```ts
// src/infrastructure/persistence/pg/PgInboxItemRepository.ts
import type { PoolClient } from 'pg';
import { ConcurrencyConflict } from '../../../application/errors.js';
import type {
  InboxItemFilter, InboxItemRepository, Page, PageRequest,
} from '../../../application/ports/InboxItemRepository.js';
import type { InboxItem } from '../../../domain/inbox/InboxItem.js';
import type { InboxItemId } from '../../../domain/inbox/value-objects/InboxItemId.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import { INBOX_ITEM_COLUMNS, toDomain, toParams, type InboxItemRow } from './inboxItemMapper.js';

export class PgInboxItemRepository implements InboxItemRepository {
  constructor(private readonly client: PoolClient) {}

  async findById(id: InboxItemId): Promise<InboxItem | null> {
    const { rows } = await this.client.query<InboxItemRow>(
      `SELECT ${INBOX_ITEM_COLUMNS} FROM inbox_item WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async insert(item: InboxItem): Promise<void> {
    await this.client.query(
      `INSERT INTO inbox_item (${INBOX_ITEM_COLUMNS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      toParams(item),
    );
  }

  async update(item: InboxItem): Promise<void> {
    const s = item.snapshot();
    const { rowCount } = await this.client.query(
      `UPDATE inbox_item SET
         status = $2, claimed_by = $3, claimed_at = $4,
         outcome = $5, completion_note = $6, completed_by = $7, completed_at = $8,
         idempotency_key = $9,
         cancel_reason = $10, cancelled_by = $11, cancelled_at = $12,
         updated_at = $13, version = $14
       WHERE id = $1 AND version = $15`,
      [
        s.id,
        s.status, s.claimedBy, s.claimedAt,
        s.completion?.outcome ?? null, s.completion?.note ?? null,
        s.completion?.by ?? null, s.completion?.at ?? null, s.completion?.idempotencyKey ?? null,
        s.cancellation?.reason ?? null, s.cancellation?.by ?? null, s.cancellation?.at ?? null,
        s.updatedAt, s.version,
        item.persistedVersion,
      ],
    );

    // 0 rows means either "gone" or "someone wrote first". Both are the caller's cue to
    // re-read; distinguishing them would cost a second query for no actionable difference.
    if (rowCount === 0) throw new ConcurrencyConflict(s.id, item.persistedVersion);
  }

  async search(filter: InboxItemFilter, page: PageRequest): Promise<Page<InboxItem>> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.statuses?.length) { params.push(filter.statuses); where.push(`status = ANY($${params.length})`); }
    if (filter.kinds?.length)    { params.push(filter.kinds);    where.push(`kind   = ANY($${params.length})`); }
    if (filter.assignee)         { params.push(filter.assignee); where.push(`assignee = $${params.length}`); }

    if (page.cursor) {
      const { createdAt, id } = decodeCursor(page.cursor);
      params.push(createdAt, id);
      where.push(`(created_at, id) < ($${params.length - 1}, $${params.length})`);
    }

    params.push(page.limit + 1); // over-fetch one to learn whether another page exists
    const { rows } = await this.client.query<InboxItemRow>(
      `SELECT ${INBOX_ITEM_COLUMNS} FROM inbox_item
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length}`,
      params,
    );

    const hasMore = rows.length > page.limit;
    const visible = hasMore ? rows.slice(0, page.limit) : rows;
    const last = visible.at(-1);

    return {
      items: visible.map(toDomain),
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
    };
  }
}
```

Row-tuple comparison `(created_at, id) < ($1, $2)` is what makes the keyset both correct and
index-friendly — it maps straight onto `inbox_item_page_idx`, so page 400 costs the same as page
1. Filters use `= ANY($n)` with an array parameter rather than generated `IN (…)` lists, so the
statement text is stable and gets a prepared-plan cache hit.

## 3.7 Transactional outbox

```ts
// src/infrastructure/persistence/pg/OutboxEventPublisher.ts
import type { PoolClient } from 'pg';
import type { EventPublisher } from '../../../application/ports/EventPublisher.js';
import type { DomainEvent } from '../../../domain/shared/DomainEvent.js';

export class OutboxEventPublisher implements EventPublisher {
  constructor(private readonly client: PoolClient) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.client.query(
        `INSERT INTO outbox_event (aggregate_id, name, payload, occurred_at)
         VALUES ($1, $2, $3, $4)`,
        [event.aggregateId, event.name, JSON.stringify(event.payload), event.occurredAt],
      );
    }
  }
}
```

The outbox is the answer to a question the exercise doesn't force but a reviewer will ask: *what
happens if the expense service is down when an item is approved?* Because the insert shares the
item's transaction, an approval is never recorded without its notification, and never notified
without being recorded. Delivery is then a separate, retryable concern:

```ts
// sketch — not built in the hour
// SELECT id, aggregate_id, name, payload, occurred_at
//   FROM outbox_event
//  WHERE published_at IS NULL
//  ORDER BY id
//  FOR UPDATE SKIP LOCKED
//  LIMIT 100;
// → hand to the subscriber, then UPDATE outbox_event SET published_at = now() WHERE id = ANY($1)
```
`FOR UPDATE SKIP LOCKED` lets several app instances drain concurrently without a lock convoy.
Consumers must be idempotent because this is at-least-once delivery — which is exactly why the
completion event carries the `idempotencyKey`.

## What this stage proves

- The five ports were the right five: two complete adapter sets, no port changed shape.
- Optimistic concurrency, ordering and rollback behave the same in memory and on Postgres, so a
  green in-memory test is meaningful.
- The domain still has zero dependencies. The mapper absorbed 100% of the impedance mismatch.

## Verify

```bash
npm run typecheck
docker compose up -d postgres
DATABASE_URL=postgres://inbox:inbox@localhost:5432/inbox npm run migrate
npm run test:integration      # Stage 5 wires the Testcontainers suite that exercises this
```

Next: [Stage 4 — the HTTP API](05-stage-4-http-api-adapter.md).
