import type { InboxItemFilter, PageRequest } from '../ports/InboxItemRepository.js';
import type { UnitOfWork } from '../ports/UnitOfWork.js';
import { toView, type InboxItemView } from '../views/InboxItemView.js';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface ListInboxItemsQuery extends InboxItemFilter, PageRequest {}

export interface InboxItemListResult {
  readonly items: readonly InboxItemView[];
  readonly nextCursor: string | null;
}

export class ListInboxItems {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(query: ListInboxItemsQuery): Promise<InboxItemListResult> {
    const limit = Math.min(Math.max(query.limit || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

    return this.uow.transaction(async (ctx) => {
      const page = await ctx.inboxItems.search(
        {
          ...(query.statuses === undefined ? {} : { statuses: query.statuses }),
          ...(query.assignee === undefined ? {} : { assignee: query.assignee }),
          ...(query.kinds === undefined ? {} : { kinds: query.kinds }),
        },
        { limit, ...(query.cursor === undefined ? {} : { cursor: query.cursor }) },
      );
      return { items: page.items.map(toView), nextCursor: page.nextCursor };
    });
  }
}
