import type { InboxItemId } from '../../domain/inbox/value-objects/InboxItemId.js';

export interface IdGenerator {
  newInboxItemId(): InboxItemId;
}
