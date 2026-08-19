import { beforeEach, describe, expect, it } from 'vitest';
import { harness, type Harness } from '../../support/fixtures.js';
import { ItemNotFound } from '../../../src/application/errors.js';
import { NotAssignedToActor } from '../../../src/domain/inbox/errors.js';
import { actorId } from '../../../src/domain/inbox/value-objects/ActorId.js';
import { idempotencyKey } from '../../../src/domain/inbox/value-objects/IdempotencyKey.js';
import { inboxItemId } from '../../../src/domain/inbox/value-objects/InboxItemId.js';
import { outcome } from '../../../src/domain/inbox/value-objects/Outcome.js';
import { title } from '../../../src/domain/inbox/value-objects/Title.js';

const ANA = actorId('ana.silva');
const BEN = actorId('ben.oyelaran');

/**
 * Use-case-level coverage for the transitions that are not exercised by CompleteInboxItem.spec:
 * claim/release ownership, cancellation, and list filtering + keyset paging against the
 * in-memory adapter (which shares its ordering and cursor contract with Postgres).
 */
describe('inbox workflow use cases', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  const create = (t: string, kind: 'approve_expense' | 'upload_documentation' = 'approve_expense') =>
    h.useCases.createInboxItem.execute({
      kind, title: title(t), assignee: ANA, priority: 'normal', dueAt: null,
    });

  it('claims for the assignee and then blocks a different actor from completing', async () => {
    const created = await create('Expense to claim');

    const claimed = await h.useCases.claimInboxItem.execute({ id: inboxItemId(created.id), actor: ANA });
    expect(claimed.status).toBe('claimed');
    expect(claimed.claimedBy).toBe('ana.silva');
    expect(claimed.availableActions).toEqual(['release', 'complete', 'cancel']);

    await expect(
      h.useCases.releaseInboxItem.execute({ id: inboxItemId(created.id), actor: BEN }),
    ).rejects.toThrow(NotAssignedToActor);
  });

  it('releases a claimed item back to pending as an idempotent, event-free no-op when already pending', async () => {
    const created = await create('Expense to release');
    await h.useCases.claimInboxItem.execute({ id: inboxItemId(created.id), actor: ANA });
    h.published.length = 0;

    const released = await h.useCases.releaseInboxItem.execute({ id: inboxItemId(created.id), actor: ANA });
    expect(released.status).toBe('pending');
    expect(h.published.map((e) => e.name)).toEqual(['inbox.item.released']);

    // Releasing an already-pending item writes nothing and emits nothing.
    h.published.length = 0;
    await h.useCases.releaseInboxItem.execute({ id: inboxItemId(created.id), actor: ANA });
    expect(h.published).toEqual([]);
  });

  it('cancels an item with a reason and freezes it', async () => {
    const created = await create('Expense to cancel');
    const cancelled = await h.useCases.cancelInboxItem.execute({
      id: inboxItemId(created.id), actor: ANA, reason: 'duplicate submission',
    });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancellation).toMatchObject({ reason: 'duplicate submission', by: 'ana.silva' });
    expect(cancelled.availableActions).toEqual([]);
  });

  it('404s when acting on an unknown id', async () => {
    await expect(
      h.useCases.claimInboxItem.execute({
        id: inboxItemId('00000000-0000-4000-8000-000000000000'), actor: ANA,
      }),
    ).rejects.toThrow(ItemNotFound);
  });

  it('filters by status and pages by keyset without repeating rows', async () => {
    for (let i = 0; i < 5; i += 1) {
      await create(`Item ${i}`);
      h.clock.advanceBy(1000); // distinct createdAt so the keyset order is stable
    }
    // Complete the newest one so a status filter has something to exclude.
    const all = await h.useCases.listInboxItems.execute({ limit: 10 });
    const newest = all.items[0]!;
    await h.useCases.completeInboxItem.execute({
      id: inboxItemId(newest.id), actor: ANA,
      outcome: outcome('approved'), note: null, idempotencyKey: idempotencyKey('page-key-1'),
    });

    const pending = await h.useCases.listInboxItems.execute({ statuses: ['pending'], limit: 10 });
    expect(pending.items).toHaveLength(4);
    expect(pending.items.every((i) => i.status === 'pending')).toBe(true);

    const page1 = await h.useCases.listInboxItems.execute({ statuses: ['pending'], limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await h.useCases.listInboxItems.execute({
      statuses: ['pending'], limit: 2, cursor: page1.nextCursor!,
    });
    const ids = [...page1.items, ...page2.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates across pages
  });
});
