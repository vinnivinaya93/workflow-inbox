import type { ActorId } from '../../domain/inbox/value-objects/ActorId.js';
import type { CompletionNote } from '../../domain/inbox/value-objects/CompletionNote.js';
import type { IdempotencyKey } from '../../domain/inbox/value-objects/IdempotencyKey.js';
import type { InboxItemId } from '../../domain/inbox/value-objects/InboxItemId.js';
import type { Outcome } from '../../domain/inbox/value-objects/Outcome.js';
import { ItemNotFound } from '../errors.js';
import type { Clock } from '../ports/Clock.js';
import type { UnitOfWork } from '../ports/UnitOfWork.js';
import { toView, type InboxItemView } from '../views/InboxItemView.js';

export interface CompleteInboxItemCommand {
  readonly id: InboxItemId;
  readonly actor: ActorId;
  readonly outcome: Outcome;
  readonly note: CompletionNote | null;
  readonly idempotencyKey: IdempotencyKey;
}

export class CompleteInboxItem {
  constructor(private readonly uow: UnitOfWork, private readonly clock: Clock) {}

  async execute(command: CompleteInboxItemCommand): Promise<InboxItemView> {
    const now = this.clock.now();

    return this.uow.transaction(async (ctx) => {
      const item = await ctx.inboxItems.findById(command.id);
      if (!item) throw new ItemNotFound(command.id);

      item.complete(
        {
          actor: command.actor,
          outcome: command.outcome,
          note: command.note,
          idempotencyKey: command.idempotencyKey,
        },
        now,
      );

      // A replayed completion is a no-op in the domain, so there is nothing to write and no
      // event to publish. Skipping the UPDATE also avoids a pointless version bump that would
      // 409 an honest concurrent reader.
      if (item.hasPendingEvents) {
        await ctx.inboxItems.update(item);
        await ctx.events.publish(item.pullEvents());
      }

      return toView(item);
    });
  }
}
