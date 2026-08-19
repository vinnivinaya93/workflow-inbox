import type { InboxItemId } from '../../domain/inbox/value-objects/InboxItemId.js';
import { ItemNotFound } from '../errors.js';
import type { UnitOfWork } from '../ports/UnitOfWork.js';
import { toView, type InboxItemView } from '../views/InboxItemView.js';

export class GetInboxItem {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(id: InboxItemId): Promise<InboxItemView> {
    return this.uow.transaction(async (ctx) => {
      const item = await ctx.inboxItems.findById(id);
      if (!item) throw new ItemNotFound(id);
      return toView(item);
    });
  }
}
