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
