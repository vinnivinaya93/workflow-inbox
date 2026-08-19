import type { Brand } from '../../shared/brand.js';
import { ValidationError } from '../../shared/errors.js';

export type InboxItemId = Brand<string, 'InboxItemId'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function inboxItemId(raw: string): InboxItemId {
  if (!UUID.test(raw)) throw new ValidationError('id', `expected a UUID, received "${raw}"`);
  return raw.toLowerCase() as InboxItemId;
}
