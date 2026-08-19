import { InboxItem } from '../../domain/inbox/InboxItem.js';
import type { ActorId } from '../../domain/inbox/value-objects/ActorId.js';
import type { ItemKind } from '../../domain/inbox/value-objects/ItemKind.js';
import type { Priority } from '../../domain/inbox/value-objects/Priority.js';
import type { Title } from '../../domain/inbox/value-objects/Title.js';
import type { Clock } from '../ports/Clock.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import type { UnitOfWork } from '../ports/UnitOfWork.js';
import { toView, type InboxItemView } from '../views/InboxItemView.js';

export interface CreateInboxItemCommand {
  readonly kind: ItemKind;
  readonly title: Title;
  readonly assignee: ActorId;
  readonly priority: Priority;
  readonly dueAt: Date | null;
}

export class CreateInboxItem {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(command: CreateInboxItemCommand): Promise<InboxItemView> {
    const now = this.clock.now();
    const item = InboxItem.create({ id: this.ids.newInboxItemId(), ...command }, now);

    return this.uow.transaction(async (ctx) => {
      await ctx.inboxItems.insert(item);
      await ctx.events.publish(item.pullEvents());
      return toView(item);
    });
  }
}
