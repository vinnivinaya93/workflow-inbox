import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

/** "Is the API healthy and fast?" — buckets sized for a human-facing internal tool. */
export const httpDuration = new Histogram({
  name: 'http_server_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

/** "How much work are operators actually clearing, and how?" */
export const completions = new Counter({
  name: 'inbox_items_completed_total',
  help: 'Inbox items completed, by kind and outcome',
  labelNames: ['kind', 'outcome'] as const,
  registers: [registry],
});

/** "Are we losing races?" A rising rate means contention worth investigating. */
export const conflicts = new Counter({
  name: 'inbox_conflicts_total',
  help: 'Rejected writes, by reason',
  labelNames: ['code'] as const,
  registers: [registry],
});

/** "Are downstream services hearing about outcomes?" The one that pages someone. */
export const outboxBacklog = new Counter({
  name: 'outbox_events_enqueued_total',
  help: 'Domain events written to the outbox, by name',
  labelNames: ['name'] as const,
  registers: [registry],
});
