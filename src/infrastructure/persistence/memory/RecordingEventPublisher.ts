import type { EventPublisher } from '../../../application/ports/EventPublisher.js';
import type { DomainEvent } from '../../../domain/shared/DomainEvent.js';

export class RecordingEventPublisher implements EventPublisher {
  constructor(private readonly sink: DomainEvent[]) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    this.sink.push(...events);
  }
}
