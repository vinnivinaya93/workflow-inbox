# Stage 1 — The Domain Model

> **Goal:** every rule about inbox items is expressible and testable with no database, no HTTP
> and no clock. Nothing in this stage imports anything outside `src/domain`.
> **In the hour:** yes — ~15 min, and it is the 15 minutes worth spending.

## Files added

```
src/domain/shared/brand.ts
src/domain/shared/DomainEvent.ts
src/domain/shared/AggregateRoot.ts
src/domain/shared/errors.ts
src/domain/inbox/value-objects/*.ts
src/domain/inbox/events.ts
src/domain/inbox/errors.ts
src/domain/inbox/InboxItem.ts
test/unit/domain/InboxItem.spec.ts
```

---

## 1.1 Shared primitives

Value objects are **branded strings with validating factories** rather than classes. A class per
scalar buys equality semantics we never need here and costs allocation plus noise at every call
site; branding still makes `ActorId` and `Title` non-interchangeable at compile time, which is
the actual bug being prevented.

```ts
// src/domain/shared/brand.ts
declare const brand: unique symbol;

/** Nominal typing for domain scalars: Brand<string, 'ActorId'> is not assignable to string. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
```

```ts
// src/domain/shared/DomainEvent.ts
export interface DomainEvent<TPayload = Record<string, unknown>> {
  /** Dotted, past-tense, stable across refactors: it is a published contract. */
  readonly name: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}
```

```ts
// src/domain/shared/AggregateRoot.ts
import type { DomainEvent } from './DomainEvent.js';

export abstract class AggregateRoot {
  #pending: DomainEvent[] = [];

  protected record(event: DomainEvent): void {
    this.#pending.push(event);
  }

  /**
   * Hands the recorded events to the caller and clears them.
   * The application layer pulls inside the same transaction as the write, so state and
   * events commit atomically (see Stage 3's outbox).
   */
  pullEvents(): readonly DomainEvent[] {
    const events = this.#pending;
    this.#pending = [];
    return events;
  }

  get hasPendingEvents(): boolean {
    return this.#pending.length > 0;
  }
}
```

```ts
// src/domain/shared/errors.ts

/** Base for every error the domain raises on purpose. Adapters map `code`, not `message`. */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** A value object was handed something it cannot represent. */
export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';

  constructor(readonly field: string, message: string) {
    super(`${field}: ${message}`);
  }
}
```

## 1.2 Value objects

Each factory is total: it either returns a valid value or throws. There is no "half-valid"
inbox item anywhere in the system, which is what lets the aggregate methods stay free of
null-checking noise.

```ts
// src/domain/inbox/value-objects/InboxItemId.ts
import type { Brand } from '../../shared/brand.js';
import { ValidationError } from '../../shared/errors.js';

export type InboxItemId = Brand<string, 'InboxItemId'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function inboxItemId(raw: string): InboxItemId {
  if (!UUID.test(raw)) throw new ValidationError('id', `expected a UUID, received "${raw}"`);
  return raw.toLowerCase() as InboxItemId;
}
```

```ts
// src/domain/inbox/value-objects/ActorId.ts
import type { Brand } from '../../shared/brand.js';
import { ValidationError } from '../../shared/errors.js';

export type ActorId = Brand<string, 'ActorId'>;

const ACTOR = /^[a-z0-9][a-z0-9._-]{1,63}$/;

/** Deliberately not an email: the inbox stores a stable internal handle, not contact data. */
export function actorId(raw: string): ActorId {
  const value = raw.trim().toLowerCase();
  if (!ACTOR.test(value)) {
    throw new ValidationError('actorId', `expected 2-64 chars of [a-z0-9._-], received "${raw}"`);
  }
  return value as ActorId;
}
```

```ts
// src/domain/inbox/value-objects/Title.ts
import type { Brand } from '../../shared/brand.js';
import { ValidationError } from '../../shared/errors.js';

export type Title = Brand<string, 'Title'>;

export const TITLE_MAX = 140;

export function title(raw: string): Title {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length === 0) throw new ValidationError('title', 'must not be blank');
  if (value.length > TITLE_MAX) {
    throw new ValidationError('title', `must be at most ${TITLE_MAX} characters`);
  }
  return value as Title;
}
```

```ts
// src/domain/inbox/value-objects/CompletionNote.ts
import type { Brand } from '../../shared/brand.js';
import { ValidationError } from '../../shared/errors.js';

export type CompletionNote = Brand<string, 'CompletionNote'>;

export const NOTE_MAX = 1000;

export function completionNote(raw: string): CompletionNote {
  const value = raw.trim();
  if (value.length === 0) throw new ValidationError('note', 'must not be blank when provided');
  if (value.length > NOTE_MAX) {
    throw new ValidationError('note', `must be at most ${NOTE_MAX} characters`);
  }
  return value as CompletionNote;
}
```

### The kind policy — the interesting value object

`ItemKind` carries behaviour, not just a label. Putting the accepted outcomes next to the kind
means adding `revoke_access` later is a one-line table edit, and the aggregate, API validation
and UI all pick it up automatically.

```ts
// src/domain/inbox/value-objects/ItemKind.ts
import { ValidationError } from '../../shared/errors.js';
import type { Outcome } from './Outcome.js';

export const ITEM_KINDS = [
  'approve_expense',
  'review_deployment',
  'upload_documentation',
  'complete_onboarding',
] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];

export interface KindPolicy {
  /** A decision needs a verdict; a task just needs doing. */
  readonly isDecision: boolean;
  readonly allowedOutcomes: readonly Outcome[];
  /** Rejecting something without saying why is not a useful audit record. */
  readonly noteRequiredFor: readonly Outcome[];
  readonly label: string;
}

export const KIND_POLICY: Readonly<Record<ItemKind, KindPolicy>> = Object.freeze({
  approve_expense: {
    isDecision: true,
    allowedOutcomes: ['approved', 'rejected'],
    noteRequiredFor: ['rejected'],
    label: 'Approve an expense',
  },
  review_deployment: {
    isDecision: true,
    allowedOutcomes: ['approved', 'rejected'],
    noteRequiredFor: ['rejected'],
    label: 'Review a deployment',
  },
  upload_documentation: {
    isDecision: false,
    allowedOutcomes: ['done'],
    noteRequiredFor: [],
    label: 'Upload documentation',
  },
  complete_onboarding: {
    isDecision: false,
    allowedOutcomes: ['done'],
    noteRequiredFor: [],
    label: 'Complete onboarding',
  },
});

export function itemKind(raw: string): ItemKind {
  const kind = ITEM_KINDS.find((k) => k === raw);
  if (!kind) {
    throw new ValidationError('kind', `expected one of ${ITEM_KINDS.join(', ')}, received "${raw}"`);
  }
  return kind;
}

export function policyFor(kind: ItemKind): KindPolicy {
  return KIND_POLICY[kind];
}
```

```ts
// src/domain/inbox/value-objects/Outcome.ts
import { ValidationError } from '../../shared/errors.js';

export const OUTCOMES = ['approved', 'rejected', 'done'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export function outcome(raw: string): Outcome {
  const value = OUTCOMES.find((o) => o === raw);
  if (!value) {
    throw new ValidationError('outcome', `expected one of ${OUTCOMES.join(', ')}, received "${raw}"`);
  }
  return value;
}
```

```ts
// src/domain/inbox/value-objects/ItemStatus.ts
export const ITEM_STATUSES = ['pending', 'claimed', 'completed', 'cancelled'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export function isTerminal(status: ItemStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}
```

```ts
// src/domain/inbox/value-objects/Priority.ts
import { ValidationError } from '../../shared/errors.js';

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Exposed so the read side can sort without hard-coding the order in SQL or the UI. */
export const PRIORITY_RANK: Readonly<Record<Priority, number>> = Object.freeze({
  urgent: 0, high: 1, normal: 2, low: 3,
});

export function priority(raw: string): Priority {
  const value = PRIORITIES.find((p) => p === raw);
  if (!value) {
    throw new ValidationError('priority', `expected one of ${PRIORITIES.join(', ')}, received "${raw}"`);
  }
  return value;
}
```

```ts
// src/domain/inbox/value-objects/IdempotencyKey.ts
import type { Brand } from '../../shared/brand.js';
import { ValidationError } from '../../shared/errors.js';

export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;

const MIN = 8;
const MAX = 128;

/**
 * Caller-supplied token identifying one *attempt* to complete an item.
 * The UI sends a value minted when the form is rendered, so a double-submit reuses it.
 */
export function idempotencyKey(raw: string): IdempotencyKey {
  const value = raw.trim();
  if (value.length < MIN || value.length > MAX) {
    throw new ValidationError('idempotencyKey', `must be ${MIN}-${MAX} characters`);
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new ValidationError('idempotencyKey', 'must contain only [A-Za-z0-9._:-]');
  }
  return value as IdempotencyKey;
}
```

## 1.3 Domain errors

Typed, with a stable `code`. Adapters switch on the class (Stage 4); logs and problem+json
carry the `code`. No adapter ever string-matches a message.

```ts
// src/domain/inbox/errors.ts
import { DomainError } from '../shared/errors.js';
import type { ItemStatus } from './value-objects/ItemStatus.js';
import type { ItemKind } from './value-objects/ItemKind.js';
import type { Outcome } from './value-objects/Outcome.js';

/** The requested transition is not legal from the current status. → HTTP 409 */
export class ItemStateConflict extends DomainError {
  readonly code = 'ITEM_STATE_CONFLICT';

  constructor(readonly action: string, readonly status: ItemStatus) {
    super(`cannot ${action} an item in status "${status}"`);
  }
}

/** The actor is not the assignee/claimer. → HTTP 403 */
export class NotAssignedToActor extends DomainError {
  readonly code = 'ITEM_NOT_ASSIGNED_TO_ACTOR';

  constructor(readonly action: string, readonly actor: string, readonly holder: string | null) {
    super(
      holder === null
        ? `only the assignee may ${action} this item, "${actor}" is not`
        : `item is held by "${holder}", "${actor}" may not ${action} it`,
    );
  }
}

/** The outcome is not legal for this kind of work, or a required note is missing. → HTTP 422 */
export class OutcomeNotAllowed extends DomainError {
  readonly code = 'ITEM_OUTCOME_NOT_ALLOWED';

  constructor(readonly kind: ItemKind, readonly outcome: Outcome, reason: string) {
    super(`outcome "${outcome}" is not allowed for kind "${kind}": ${reason}`);
  }
}

/** Already completed under a different idempotency key. → HTTP 409 */
export class CompletionConflict extends DomainError {
  readonly code = 'ITEM_COMPLETION_CONFLICT';

  constructor(readonly existingKey: string, readonly attemptedKey: string) {
    super(
      `item was already completed under idempotency key "${existingKey}"; ` +
        `refusing to re-complete under "${attemptedKey}"`,
    );
  }
}
```

## 1.4 Domain events

```ts
// src/domain/inbox/events.ts
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
```

Payloads carry only what a downstream context needs to react (`inbox.item.completed` is what
tells the expense service the verdict). They deliberately do **not** carry the whole item —
a fat event turns every consumer into a coupled reader of our internal shape.

## 1.5 The aggregate

```ts
// src/domain/inbox/InboxItem.ts
import { AggregateRoot } from '../shared/AggregateRoot.js';
import {
  CompletionConflict, ItemStateConflict, NotAssignedToActor, OutcomeNotAllowed,
} from './errors.js';
import {
  inboxItemCancelled, inboxItemClaimed, inboxItemCompleted, inboxItemCreated, inboxItemReleased,
} from './events.js';
import type { ActorId } from './value-objects/ActorId.js';
import type { CompletionNote } from './value-objects/CompletionNote.js';
import type { IdempotencyKey } from './value-objects/IdempotencyKey.js';
import type { InboxItemId } from './value-objects/InboxItemId.js';
import type { ItemKind } from './value-objects/ItemKind.js';
import { policyFor } from './value-objects/ItemKind.js';
import type { ItemStatus } from './value-objects/ItemStatus.js';
import { isTerminal } from './value-objects/ItemStatus.js';
import type { Outcome } from './value-objects/Outcome.js';
import type { Priority } from './value-objects/Priority.js';
import type { Title } from './value-objects/Title.js';

export interface Completion {
  readonly outcome: Outcome;
  readonly note: CompletionNote | null;
  readonly by: ActorId;
  readonly at: Date;
  readonly idempotencyKey: IdempotencyKey;
}

export interface Cancellation {
  readonly reason: string;
  readonly by: ActorId;
  readonly at: Date;
}

/** The full persisted shape. The mapper in Stage 3 is the only thing outside that reads it. */
export interface InboxItemState {
  readonly id: InboxItemId;
  readonly kind: ItemKind;
  readonly title: Title;
  readonly assignee: ActorId;
  readonly priority: Priority;
  readonly dueAt: Date | null;
  readonly status: ItemStatus;
  readonly claimedBy: ActorId | null;
  readonly claimedAt: Date | null;
  readonly completion: Completion | null;
  readonly cancellation: Cancellation | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export interface CreateInboxItemProps {
  readonly id: InboxItemId;
  readonly kind: ItemKind;
  readonly title: Title;
  readonly assignee: ActorId;
  readonly priority: Priority;
  readonly dueAt: Date | null;
}

export interface CompleteProps {
  readonly actor: ActorId;
  readonly outcome: Outcome;
  readonly note: CompletionNote | null;
  readonly idempotencyKey: IdempotencyKey;
}

export class InboxItem extends AggregateRoot {
  /**
   * The version as it exists in storage right now — the optimistic-concurrency guard.
   * `state.version` moves as the aggregate changes in memory; this one does not, so the
   * repository can say `WHERE version = persistedVersion` and `SET version = state.version`.
   */
  readonly persistedVersion: number;

  private constructor(private state: InboxItemState) {
    super();
    this.persistedVersion = state.version;
  }

  // ── construction ────────────────────────────────────────────────────────────

  static create(props: CreateInboxItemProps, now: Date): InboxItem {
    const item = new InboxItem({
      ...props,
      status: 'pending',
      claimedBy: null,
      claimedAt: null,
      completion: null,
      cancellation: null,
      createdAt: now,
      updatedAt: now,
      version: 0,
    });
    item.record(
      inboxItemCreated(props.id, now, {
        kind: props.kind, assignee: props.assignee, priority: props.priority,
      }),
    );
    return item;
  }

  /** Rebuild from storage. Emits nothing: loading is not a business event. */
  static rehydrate(state: InboxItemState): InboxItem {
    return new InboxItem(state);
  }

  // ── read access ─────────────────────────────────────────────────────────────

  get id(): InboxItemId { return this.state.id; }
  get kind(): ItemKind { return this.state.kind; }
  get status(): ItemStatus { return this.state.status; }
  get assignee(): ActorId { return this.state.assignee; }
  get claimedBy(): ActorId | null { return this.state.claimedBy; }
  get completion(): Completion | null { return this.state.completion; }
  get version(): number { return this.state.version; }

  /** Immutable copy for the mapper and the view builder. */
  snapshot(): InboxItemState { return { ...this.state }; }

  /** Who, if anyone, currently holds the item. */
  get holder(): ActorId | null { return this.state.claimedBy; }

  // ── behaviour ───────────────────────────────────────────────────────────────

  claim(actor: ActorId, now: Date): void {
    if (this.state.status === 'claimed') {
      // Idempotent re-claim by the same actor; a different actor is a real conflict.
      if (this.state.claimedBy === actor) return;
      throw new NotAssignedToActor('claim', actor, this.state.claimedBy);
    }
    this.assertNotTerminal('claim');
    if (this.state.assignee !== actor) {
      throw new NotAssignedToActor('claim', actor, null);
    }

    this.state = {
      ...this.state,
      status: 'claimed', claimedBy: actor, claimedAt: now,
      ...this.touch(now),
    };
    this.record(inboxItemClaimed(this.state.id, now, { by: actor }));
  }

  release(actor: ActorId, now: Date): void {
    if (this.state.status === 'pending') return; // already released — idempotent
    this.assertNotTerminal('release');
    if (this.state.claimedBy !== actor) {
      throw new NotAssignedToActor('release', actor, this.state.claimedBy);
    }

    this.state = {
      ...this.state,
      status: 'pending', claimedBy: null, claimedAt: null,
      ...this.touch(now),
    };
    this.record(inboxItemReleased(this.state.id, now, { by: actor }));
  }

  /**
   * The one method that matters.
   *
   * Ordering of the guards is deliberate:
   *   1. idempotent replay wins over everything, so a retry after a timeout succeeds even
   *      though the item is now in a terminal state;
   *   2. terminal states are rejected next;
   *   3. authorisation;
   *   4. outcome policy;
   *   5. only then mutate — auto-claiming a pending item so that the claim and the completion
   *      are one atomic act and a double-click cannot interleave someone else's claim.
   *
   * Every guard runs before the first assignment, so a rejected completion leaves the
   * aggregate byte-identical and event-free rather than half-claimed.
   */
  complete(props: CompleteProps, now: Date): void {
    const existing = this.state.completion;
    if (existing) {
      if (existing.idempotencyKey === props.idempotencyKey) return; // replay: no event, no change
      throw new CompletionConflict(existing.idempotencyKey, props.idempotencyKey);
    }
    this.assertNotTerminal('complete');

    const alreadyClaimed = this.state.status === 'claimed';
    if (alreadyClaimed) {
      if (this.state.claimedBy !== props.actor) {
        throw new NotAssignedToActor('complete', props.actor, this.state.claimedBy);
      }
    } else if (this.state.assignee !== props.actor) {
      throw new NotAssignedToActor('complete', props.actor, null);
    }

    this.assertOutcomeAllowed(props.outcome, props.note);

    if (!alreadyClaimed) this.claim(props.actor, now); // records inbox.item.claimed

    const completion: Completion = {
      outcome: props.outcome,
      note: props.note,
      by: props.actor,
      at: now,
      idempotencyKey: props.idempotencyKey,
    };
    this.state = { ...this.state, status: 'completed', completion, ...this.touch(now) };
    this.record(
      inboxItemCompleted(this.state.id, now, {
        by: props.actor, kind: this.state.kind, outcome: props.outcome,
        idempotencyKey: props.idempotencyKey,
      }),
    );
  }

  cancel(actor: ActorId, reason: string, now: Date): void {
    this.assertNotTerminal('cancel');
    const trimmed = reason.trim();
    const cancellation: Cancellation = {
      reason: trimmed.length > 0 ? trimmed : 'no reason given',
      by: actor,
      at: now,
    };
    this.state = {
      ...this.state,
      status: 'cancelled', cancellation, claimedBy: null, claimedAt: null,
      ...this.touch(now),
    };
    this.record(inboxItemCancelled(this.state.id, now, { by: actor, reason: cancellation.reason }));
  }

  // ── guards and bookkeeping ──────────────────────────────────────────────────

  /** One state change = one version = one updatedAt. Spread into every mutation. */
  private touch(now: Date): Pick<InboxItemState, 'updatedAt' | 'version'> {
    return { updatedAt: now, version: this.state.version + 1 };
  }

  private assertNotTerminal(action: string): void {
    if (isTerminal(this.state.status)) throw new ItemStateConflict(action, this.state.status);
  }

  private assertOutcomeAllowed(value: Outcome, note: CompletionNote | null): void {
    const policy = policyFor(this.state.kind);
    if (!policy.allowedOutcomes.includes(value)) {
      throw new OutcomeNotAllowed(
        this.state.kind, value, `allowed outcomes are ${policy.allowedOutcomes.join(', ')}`,
      );
    }
    if (policy.noteRequiredFor.includes(value) && note === null) {
      throw new OutcomeNotAllowed(this.state.kind, value, 'a note is required for this outcome');
    }
  }
}
```

### Notes on the choices inside the aggregate

- **`now` is a parameter, never `new Date()`.** The domain has no clock; time enters through a
  port (Stage 2). This is what makes "completed at" assertions in tests exact rather than
  flaky, and it is the same discipline that keeps a durable-execution rewrite possible later.
- **State is replaced, not mutated** (`this.state = { ...this.state, … }`). Each transition is
  one visible assignment, so reviewing "what did this method change?" is a single line.
- **Two version numbers, on purpose.** `state.version` counts state changes in memory;
  `persistedVersion` is frozen at load time. The repository writes
  `SET version = state.version WHERE version = persistedVersion`. Keeping both means the view
  returned to the caller reports the version that is actually in the database after the commit —
  with a single field, a client would read `version: 0` back from a write that stored `1` and
  its next conditional request would fail for no reason. It also means the auto-claim path
  legitimately advances the version by 2, because two things happened.
  One constraint remains, and it is documented rather than defended: an instance must be saved
  at most once per transaction. Every use case loads → mutates → saves once.
- **Idempotent no-ops record no event.** A replayed completion must not emit a second
  `inbox.item.completed`, or downstream consumers would double-book the outcome — the exact bug
  the idempotency key exists to prevent.

## 1.6 Domain tests

The cheapest, highest-value tests in the codebase: no mocks, no I/O, and they encode the eight
invariants from Stage 0 directly.

```ts
// test/unit/domain/InboxItem.spec.ts
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
```

## What this stage proves

- Every rule from Stage 0's invariant list is executable and has a named test.
- The tests need no database, no HTTP server, no fake timers, and no mocking framework —
  the design, not the tooling, made that possible.
- A reviewer can read `InboxItem.ts` top to bottom and know the whole business.

## Verify

```bash
npm run typecheck
npm test          # test/unit
```

Next: [Stage 2 — ports and use cases](03-stage-2-application-layer.md).
