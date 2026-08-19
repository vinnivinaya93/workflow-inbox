import type { DomainEvent } from './DomainEvent.js';

export abstract class AggregateRoot {
  #pending: DomainEvent[] = [];

  protected record(event: DomainEvent): void {
    this.#pending.push(event);
  }

  /**
   * Hands the recorded events to the caller and clears them.
   * The application layer pulls inside the same transaction as the write, so state and
   * events commit atomically (see the outbox adapter).
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
