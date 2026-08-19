import type { EventPublisher } from '../../application/ports/EventPublisher.js';
import type { DomainEvent } from '../../domain/shared/DomainEvent.js';
import { INBOX_EVENTS } from '../../domain/inbox/events.js';
import { completions, outboxBacklog } from './metrics.js';

/**
 * Business metrics derive from domain events, not from HTTP handlers.
 * Consequence: the HTML UI is measured identically to the JSON API, for free, and a
 * replayed (no-op) completion is correctly *not* counted — because it emits no event.
 */
export class MeteredEventPublisher implements EventPublisher {
  constructor(private readonly inner: EventPublisher) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    await this.inner.publish(events);
    for (const event of events) {
      outboxBacklog.inc({ name: event.name });
      if (event.name === INBOX_EVENTS.completed) {
        const p = event.payload as { kind: string; outcome: string };
        completions.inc({ kind: p.kind, outcome: p.outcome });
      }
    }
  }
}
