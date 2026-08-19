import { ValidationError } from '../../shared/errors.js';

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Exposed so the read side can sort without hard-coding the order in SQL or the UI. */
export const PRIORITY_RANK: Readonly<Record<Priority, number>> = Object.freeze({
  urgent: 0, high: 1, normal: 2, low: 3,
});

export function priority(raw: string): Priority {
  const value = PRIORITIES.find((p) => p === raw);
  if (!value) {
    throw new ValidationError('priority', `expected one of ${PRIORITIES.join(', ')}, received "${raw}"`);
  }
  return value;
}
