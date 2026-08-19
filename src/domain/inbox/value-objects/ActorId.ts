import type { Brand } from '../../shared/brand.js';
import { ValidationError } from '../../shared/errors.js';

export type ActorId = Brand<string, 'ActorId'>;

const ACTOR = /^[a-z0-9][a-z0-9._-]{1,63}$/;

/** Deliberately not an email: the inbox stores a stable internal handle, not contact data. */
export function actorId(raw: string): ActorId {
  const value = raw.trim().toLowerCase();
  if (!ACTOR.test(value)) {
    throw new ValidationError('actorId', `expected 2-64 chars of [a-z0-9._-], received "${raw}"`);
  }
  return value as ActorId;
}
