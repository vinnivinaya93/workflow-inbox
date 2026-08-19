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
    await create('Arrived mid-pagination'); // would shift an OFFSET query
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
