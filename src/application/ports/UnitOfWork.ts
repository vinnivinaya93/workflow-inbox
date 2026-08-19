import type { EventPublisher } from './EventPublisher.js';
import type { InboxItemRepository } from './InboxItemRepository.js';

/** Everything transactional, handed to the callback already enlisted in one transaction. */
export interface TransactionContext {
  readonly inboxItems: InboxItemRepository;
  readonly events: EventPublisher;
}

export interface UnitOfWork {
  /** Commits on resolve, rolls back on throw. Never nested. */
  transaction<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T>;
}
