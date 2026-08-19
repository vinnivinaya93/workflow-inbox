import { describe, expect, it } from 'vitest';
import { InboxItem } from '../../../src/domain/inbox/InboxItem.js';
import {
  CompletionConflict, ItemStateConflict, NotAssignedToActor, OutcomeNotAllowed,
} from '../../../src/domain/inbox/errors.js';
import { actorId } from '../../../src/domain/inbox/value-objects/ActorId.js';
import { completionNote } from '../../../src/domain/inbox/value-objects/CompletionNote.js';
import { idempotencyKey } from '../../../src/domain/inbox/value-objects/IdempotencyKey.js';
import { inboxItemId } from '../../../src/domain/inbox/value-objects/InboxItemId.js';
import type { ItemKind } from '../../../src/domain/inbox/value-objects/ItemKind.js';
import { title } from '../../../src/domain/inbox/value-objects/Title.js';

const T0 = new Date('2026-08-18T09:00:00.000Z');
const T1 = new Date('2026-08-18T09:05:00.000Z');

const ANA = actorId('ana.silva');
const BEN = actorId('ben.oyelaran');
const KEY = idempotencyKey('attempt-0001');

function anItem(kind: ItemKind = 'approve_expense'): InboxItem {
  return InboxItem.create(
    {
      id: inboxItemId('7b2f1c34-9a5e-4f21-8c0d-1e2f3a4b5c6d'),
      kind,
      title: title('Expense EXP-1042 — $420 travel'),
      assignee: ANA,
      priority: 'normal',
      dueAt: null,
    },
    T0,
  );
}

const names = (item: InboxItem) => item.pullEvents().map((e) => e.name);

describe('InboxItem lifecycle', () => {
  it('is created pending and announces itself', () => {
    const item = anItem();
    expect(item.status).toBe('pending');
    expect(names(item)).toEqual(['inbox.item.created']);
  });

  it('claims for the assignee only', () => {
    const item = anItem();
    item.pullEvents();
    expect(() => item.claim(BEN, T1)).toThrow(NotAssignedToActor);
    item.claim(ANA, T1);
    expect(item.status).toBe('claimed');
    expect(names(item)).toEqual(['inbox.item.claimed']);
  });

  it('treats a re-claim by the same actor as a no-op', () => {
    const item = anItem();
    item.claim(ANA, T1);
    item.pullEvents();
    item.claim(ANA, T1);
    expect(names(item)).toEqual([]);
  });

  it('auto-claims when the assignee completes a pending item', () => {
    const item = anItem();
    item.pullEvents();
    item.complete({ actor: ANA, outcome: 'approved', note: null, idempotencyKey: KEY }, T1);
    expect(item.status).toBe('completed');
    expect(names(item)).toEqual(['inbox.item.claimed', 'inbox.item.completed']);
  });

  it('refuses completion by anyone but the claimer', () => {
    const item = anItem();
    item.claim(ANA, T0);
    expect(() =>
      item.complete({ actor: BEN, outcome: 'approved', note: null, idempotencyKey: KEY }, T1),
    ).toThrow(NotAssignedToActor);
  });

  it('is idempotent: replaying the same key changes nothing and emits nothing', () => {
    const item = anItem();
    item.complete({ actor: ANA, outcome: 'approved', note: null, idempotencyKey: KEY }, T0);
    const first = item.completion;
    item.pullEvents();

    item.complete({ actor: ANA, outcome: 'rejected', note: completionNote('changed my mind'), idempotencyKey: KEY }, T1);

    expect(item.completion).toEqual(first); // outcome NOT overwritten
    expect(names(item)).toEqual([]);
  });

  it('rejects a second completion under a different key', () => {
    const item = anItem();
    item.complete({ actor: ANA, outcome: 'approved', note: null, idempotencyKey: KEY }, T0);
    expect(() =>
      item.complete(
        { actor: ANA, outcome: 'approved', note: null, idempotencyKey: idempotencyKey('attempt-0002') },
        T1,
      ),
    ).toThrow(CompletionConflict);
  });

  it('enforces the kind policy', () => {
    const upload = anItem('upload_documentation');
    expect(() =>
      upload.complete({ actor: ANA, outcome: 'rejected', note: null, idempotencyKey: KEY }, T1),
    ).toThrow(OutcomeNotAllowed);

    const expense = anItem('approve_expense');
    expect(() =>
      expense.complete({ actor: ANA, outcome: 'rejected', note: null, idempotencyKey: KEY }, T1),
    ).toThrow(OutcomeNotAllowed); // rejection requires a note
  });

  it('leaves the aggregate untouched when a completion is refused', () => {
    const item = anItem('upload_documentation');
    item.pullEvents();
    const before = item.snapshot();

    expect(() =>
      item.complete({ actor: ANA, outcome: 'rejected', note: null, idempotencyKey: KEY }, T1),
    ).toThrow(OutcomeNotAllowed);

    expect(item.snapshot()).toEqual(before); // no auto-claim leaked through
    expect(names(item)).toEqual([]);
  });

  it('freezes terminal items', () => {
    const item = anItem();
    item.cancel(BEN, 'expense withdrawn', T0);
    expect(() => item.claim(ANA, T1)).toThrow(ItemStateConflict);
    expect(() =>
      item.complete({ actor: ANA, outcome: 'approved', note: null, idempotencyKey: KEY }, T1),
    ).toThrow(ItemStateConflict);
  });

  it('stamps updatedAt from the injected clock and versions every change', () => {
    const item = anItem();
    expect(item.snapshot().version).toBe(0);
    expect(item.persistedVersion).toBe(0);

    item.claim(ANA, T1);
    expect(item.snapshot().updatedAt).toEqual(T1);
    expect(item.snapshot().version).toBe(1);
    expect(item.persistedVersion).toBe(0); // the optimistic guard does not move
  });

  it('advances the version twice when completing auto-claims', () => {
    const item = anItem();
    item.complete({ actor: ANA, outcome: 'approved', note: null, idempotencyKey: KEY }, T1);
    expect(item.snapshot().version).toBe(2);
  });
});
