import type { EventPublisher } from '../../../application/ports/EventPublisher.js';
import type { TransactionContext, UnitOfWork } from '../../../application/ports/UnitOfWork.js';
import type { DomainEvent } from '../../../domain/shared/DomainEvent.js';
import { InMemoryInboxItemRepository, InMemoryStore } from './InMemoryInboxItemRepository.js';
import { RecordingEventPublisher } from './RecordingEventPublisher.js';

export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(
    private readonly store: InMemoryStore = new InMemoryStore(),
    readonly published: DomainEvent[] = [],
    /**
     * Lets the composition root wrap the publisher with metrics, so the default in-memory
     * runtime is measured identically to Postgres. Defaults to identity, so tests that build a
     * unit of work directly stay free of global metric state.
     */
    private readonly decorate: (publisher: EventPublisher) => EventPublisher = (p) => p,
  ) {}

  async transaction<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    const before = this.store.snapshot();
    const staged: DomainEvent[] = [];
    const ctx: TransactionContext = {
      inboxItems: new InMemoryInboxItemRepository(this.store),
      events: this.decorate(new RecordingEventPublisher(staged)),
    };

    try {
      const result = await work(ctx);
      this.published.push(...staged); // commit: events become visible with the state
      return result;
    } catch (error) {
      this.store.restore(before); // rollback, including the staged events
      throw error;
    }
  }
}
