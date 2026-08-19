import type { Brand } from '../../shared/brand.js';
import { ValidationError } from '../../shared/errors.js';

export type Title = Brand<string, 'Title'>;

export const TITLE_MAX = 140;

export function title(raw: string): Title {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length === 0) throw new ValidationError('title', 'must not be blank');
  if (value.length > TITLE_MAX) {
    throw new ValidationError('title', `must be at most ${TITLE_MAX} characters`);
  }
  return value as Title;
}
