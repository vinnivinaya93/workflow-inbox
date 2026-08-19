import type { PoolClient } from 'pg';
import type { EventPublisher } from '../../../application/ports/EventPublisher.js';
import type { DomainEvent } from '../../../domain/shared/DomainEvent.js';

export class OutboxEventPublisher implements EventPublisher {
  constructor(private readonly client: PoolClient) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.client.query(
        `INSERT INTO outbox_event (aggregate_id, name, payload, occurred_at)
         VALUES ($1, $2, $3, $4)`,
        [event.aggregateId, event.name, JSON.stringify(event.payload), event.occurredAt],
      );
    }
  }
}
