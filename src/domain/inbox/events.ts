import type { DomainEvent } from '../shared/DomainEvent.js';
import type { ActorId } from './value-objects/ActorId.js';
import type { InboxItemId } from './value-objects/InboxItemId.js';
import type { ItemKind } from './value-objects/ItemKind.js';
import type { Outcome } from './value-objects/Outcome.js';
import type { Priority } from './value-objects/Priority.js';

export const INBOX_EVENTS = {
  created: 'inbox.item.created',
  claimed: 'inbox.item.claimed',
  released: 'inbox.item.released',
  completed: 'inbox.item.completed',
  cancelled: 'inbox.item.cancelled',
} as const;

export type InboxEventName = (typeof INBOX_EVENTS)[keyof typeof INBOX_EVENTS];

function event<T extends Record<string, unknown>>(
  name: InboxEventName,
  id: InboxItemId,
  at: Date,
  payload: T,
): DomainEvent<T> {
  return Object.freeze({ name, aggregateId: id, occurredAt: at, payload: Object.freeze(payload) });
}

export const inboxItemCreated = (
  id: InboxItemId, at: Date, p: { kind: ItemKind; assignee: ActorId; priority: Priority },
) => event(INBOX_EVENTS.created, id, at, p);

export const inboxItemClaimed = (id: InboxItemId, at: Date, p: { by: ActorId }) =>
  event(INBOX_EVENTS.claimed, id, at, p);

export const inboxItemReleased = (id: InboxItemId, at: Date, p: { by: ActorId }) =>
  event(INBOX_EVENTS.released, id, at, p);

export const inboxItemCompleted = (
  id: InboxItemId, at: Date, p: { by: ActorId; kind: ItemKind; outcome: Outcome; idempotencyKey: string },
) => event(INBOX_EVENTS.completed, id, at, p);

export const inboxItemCancelled = (id: InboxItemId, at: Date, p: { by: ActorId; reason: string }) =>
  event(INBOX_EVENTS.cancelled, id, at, p);
