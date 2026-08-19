import { ConcurrencyConflict } from '../../../application/errors.js';
import type {
  InboxItemFilter, InboxItemRepository, Page, PageRequest,
} from '../../../application/ports/InboxItemRepository.js';
import { InboxItem, type InboxItemState } from '../../../domain/inbox/InboxItem.js';
import type { InboxItemId } from '../../../domain/inbox/value-objects/InboxItemId.js';

/** Shared store so every transaction in a process sees the same data. */
export class InMemoryStore {
  readonly rows = new Map<string, InboxItemState>();

  snapshot(): Map<string, InboxItemState> { return new Map(this.rows); }
  restore(rows: Map<string, InboxItemState>): void {
    this.rows.clear();
    for (const [k, v] of rows) this.rows.set(k, v);
  }
}

export class InMemoryInboxItemRepository implements InboxItemRepository {
  constructor(private readonly store: InMemoryStore) {}

  async findById(id: InboxItemId): Promise<InboxItem | null> {
    const row = this.store.rows.get(id);
    return row ? InboxItem.rehydrate(structuredClone(row)) : null;
  }

  async insert(item: InboxItem): Promise<void> {
    const state = item.snapshot();
    if (this.store.rows.has(state.id)) {
      throw new ConcurrencyConflict(state.id, state.version);
    }
    this.store.rows.set(state.id, structuredClone(state));
  }

  async update(item: InboxItem): Promise<void> {
    const state = item.snapshot();
    const current = this.store.rows.get(state.id);
    if (!current || current.version !== item.persistedVersion) {
      throw new ConcurrencyConflict(state.id, item.persistedVersion);
    }
    this.store.rows.set(state.id, structuredClone(state));
  }

  async search(filter: InboxItemFilter, page: PageRequest): Promise<Page<InboxItem>> {
    // Same ordering contract as the SQL adapter: newest first, id as the tiebreaker.
    const ordered = [...this.store.rows.values()]
      .filter((r) => (filter.statuses ? filter.statuses.includes(r.status) : true))
      .filter((r) => (filter.assignee ? r.assignee === filter.assignee : true))
      .filter((r) => (filter.kinds ? filter.kinds.includes(r.kind) : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));

    const start = page.cursor ? ordered.findIndex((r) => cursorOf(r) === page.cursor) + 1 : 0;
    const slice = ordered.slice(start, start + page.limit);
    const last = slice.at(-1);
    const more = start + page.limit < ordered.length;

    return {
      items: slice.map((r) => InboxItem.rehydrate(structuredClone(r))),
      nextCursor: more && last ? cursorOf(last) : null,
    };
  }
}

const cursorOf = (r: InboxItemState) => `${r.createdAt.toISOString()}|${r.id}`;
