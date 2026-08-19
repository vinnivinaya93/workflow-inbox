import { ValidationError } from '../../shared/errors.js';

export const OUTCOMES = ['approved', 'rejected', 'done'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export function outcome(raw: string): Outcome {
  const value = OUTCOMES.find((o) => o === raw);
  if (!value) {
    throw new ValidationError('outcome', `expected one of ${OUTCOMES.join(', ')}, received "${raw}"`);
  }
  return value;
}
