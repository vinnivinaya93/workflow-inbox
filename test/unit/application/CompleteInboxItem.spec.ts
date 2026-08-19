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

  beforeEach(() => {
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
    expect(view.version).toBe(2); // auto-claim + complete
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

    expect(h.published).toEqual([]); // no duplicate notification
    expect(h.store.rows.get(created.id)).toEqual(stored); // byte-identical row, updatedAt untouched
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
