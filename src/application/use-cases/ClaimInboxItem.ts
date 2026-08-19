import type { ActorId } from '../../domain/inbox/value-objects/ActorId.js';
import type { InboxItemId } from '../../domain/inbox/value-objects/InboxItemId.js';
import { ItemNotFound } from '../errors.js';
import type { Clock } from '../ports/Clock.js';
import type { UnitOfWork } from '../ports/UnitOfWork.js';
import { toView, type InboxItemView } from '../views/InboxItemView.js';

export interface ClaimInboxItemCommand {
  readonly id: InboxItemId;
  readonly actor: ActorId;
}

export class ClaimInboxItem {
  constructor(private readonly uow: UnitOfWork, private readonly clock: Clock) {}

  async execute(command: ClaimInboxItemCommand): Promise<InboxItemView> {
    const now = this.clock.now();
    return this.uow.transaction(async (ctx) => {
      const item = await ctx.inboxItems.findById(command.id);
      if (!item) throw new ItemNotFound(command.id);

      item.claim(command.actor, now);

      if (item.hasPendingEvents) {
        await ctx.inboxItems.update(item);
        await ctx.events.publish(item.pullEvents());
      }
      return toView(item);
    });
  }
}
