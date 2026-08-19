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
