import type { InboxItem } from '../../domain/inbox/InboxItem.js';
import type { ActorId } from '../../domain/inbox/value-objects/ActorId.js';
import type { InboxItemId } from '../../domain/inbox/value-objects/InboxItemId.js';
import type { ItemKind } from '../../domain/inbox/value-objects/ItemKind.js';
import type { ItemStatus } from '../../domain/inbox/value-objects/ItemStatus.js';

export interface InboxItemFilter {
  readonly statuses?: readonly ItemStatus[];
  readonly assignee?: ActorId;
  readonly kinds?: readonly ItemKind[];
}

export interface PageRequest {
  readonly limit: number;
  /** Opaque keyset cursor. The application never parses it; only the adapter understands it. */
  readonly cursor?: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface InboxItemRepository {
  findById(id: InboxItemId): Promise<InboxItem | null>;
  search(filter: InboxItemFilter, page: PageRequest): Promise<Page<InboxItem>>;
  insert(item: InboxItem): Promise<void>;
  /** Optimistic: throws ConcurrencyConflict if the stored version moved on. */
  update(item: InboxItem): Promise<void>;
}
