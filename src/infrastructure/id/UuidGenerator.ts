import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../../application/ports/IdGenerator.js';
import { inboxItemId, type InboxItemId } from '../../domain/inbox/value-objects/InboxItemId.js';

export class UuidGenerator implements IdGenerator {
  newInboxItemId(): InboxItemId {
    return inboxItemId(randomUUID());
  }
}
