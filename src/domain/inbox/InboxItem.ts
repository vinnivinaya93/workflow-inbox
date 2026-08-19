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

/** The full persisted shape. The mapper is the only thing outside that reads it. */
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
