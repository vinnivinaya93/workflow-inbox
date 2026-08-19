import type { Brand } from '../../shared/brand.js';
import { ValidationError } from '../../shared/errors.js';

export type CompletionNote = Brand<string, 'CompletionNote'>;

export const NOTE_MAX = 1000;

export function completionNote(raw: string): CompletionNote {
  const value = raw.trim();
  if (value.length === 0) throw new ValidationError('note', 'must not be blank when provided');
  if (value.length > NOTE_MAX) {
    throw new ValidationError('note', `must be at most ${NOTE_MAX} characters`);
  }
  return value as CompletionNote;
}
