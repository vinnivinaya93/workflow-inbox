import type { DomainEvent } from '../../domain/shared/DomainEvent.js';

export interface EventPublisher {
  /** Called inside the write transaction; the adapter decides how it eventually leaves. */
  publish(events: readonly DomainEvent[]): Promise<void>;
}
