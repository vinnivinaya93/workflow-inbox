import type { Brand } from '../../shared/brand.js';
import { ValidationError } from '../../shared/errors.js';

export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;

const MIN = 8;
const MAX = 128;

/**
 * Caller-supplied token identifying one *attempt* to complete an item.
 * The UI sends a value minted when the form is rendered, so a double-submit reuses it.
 */
export function idempotencyKey(raw: string): IdempotencyKey {
  const value = raw.trim();
  if (value.length < MIN || value.length > MAX) {
    throw new ValidationError('idempotencyKey', `must be ${MIN}-${MAX} characters`);
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new ValidationError('idempotencyKey', 'must contain only [A-Za-z0-9._:-]');
  }
  return value as IdempotencyKey;
}
