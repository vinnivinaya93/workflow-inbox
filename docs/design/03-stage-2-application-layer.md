# Stage 2 — Ports and Use Cases

> **Goal:** name every capability the domain needs from the outside world as an interface, and
> express each operator action as one transactional use case. Still no framework, still no SQL.
> **In the hour:** yes — ~10 min.

## Files added

```
src/application/ports/{Clock,IdGenerator,EventPublisher,InboxItemRepository,UnitOfWork}.ts
src/application/errors.ts
src/application/views/InboxItemView.ts
src/application/use-cases/{CreateInboxItem,ListInboxItems,GetInboxItem,ClaimInboxItem,
                           ReleaseInboxItem,CompleteInboxItem,CancelInboxItem}.ts
```

---

## 2.1 The ports

Five, no more. Each one exists because the domain genuinely cannot do it itself: know the time,
mint an id, remember things, tell the world, and make a group of writes atomic.

```ts
// src/application/ports/Clock.ts
export interface Clock {
  now(): Date;
}
```

```ts
// src/application/ports/IdGenerator.ts
import type { InboxItemId } from '../../domain/inbox/value-objects/InboxItemId.js';

export interface IdGenerator {
  newInboxItemId(): InboxItemId;
}
```

```ts
// src/application/ports/EventPublisher.ts
import type { DomainEvent } from '../../domain/shared/DomainEvent.js';

export interface EventPublisher {
  /** Called inside the write transaction; the adapter decides how it eventually leaves. */
  publish(events: readonly DomainEvent[]): Promise<void>;
}
```

```ts
// src/application/ports/InboxItemRepository.ts
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
```

Note what is *absent*: no `save()` that guesses insert-vs-update, no `findAll()`, no
`query(sql)`. The port describes what the use cases need, and nothing else. Adding a method
here is a deliberate act, which is what keeps adapters small.

```ts
// src/application/ports/UnitOfWork.ts
import type { EventPublisher } from './EventPublisher.js';
import type { InboxItemRepository } from './InboxItemRepository.js';

/** Everything transactional, handed to the callback already enlisted in one transaction. */
export interface TransactionContext {
  readonly inboxItems: InboxItemRepository;
  readonly events: EventPublisher;
}

export interface UnitOfWork {
  /** Commits on resolve, rolls back on throw. Never nested. */
  transaction<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T>;
}
```

**Why a unit of work rather than injecting a repository directly?** Because the state change and
the emitted events must commit together — otherwise an operator sees "approved" in the UI while
the expense service never hears about it, or the reverse. Making the transaction the thing you
receive means a use case cannot forget to be atomic; there is no repository available outside
one.

## 2.2 Application errors

Errors that belong to orchestration, not to the domain's rules. Both these are *port contract*
errors: an adapter promises to throw them.

```ts
// src/application/errors.ts
export class ApplicationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** No such aggregate. → HTTP 404 */
export class ItemNotFound extends ApplicationError {
  constructor(readonly id: string) {
    super('ITEM_NOT_FOUND', `inbox item "${id}" was not found`);
  }
}

/** Someone else wrote first. → HTTP 409, safe for the caller to retry after re-reading. */
export class ConcurrencyConflict extends ApplicationError {
  constructor(readonly id: string, readonly expectedVersion: number) {
    super(
      'CONCURRENCY_CONFLICT',
      `inbox item "${id}" changed since it was read (expected version ${expectedVersion})`,
    );
  }
}

/** A cursor that did not come from us, or came from an older deploy. → HTTP 400 */
export class InvalidCursor extends ApplicationError {
  constructor(readonly cursor: string) {
    super('INVALID_CURSOR', `cursor "${cursor}" is not valid`);
  }
}
```

## 2.3 The view model

The domain aggregate never leaves the application layer. Use cases return a flat, serialisable
view — which is also what stops an HTTP response shape from quietly becoming a constraint on
the aggregate.

```ts
// src/application/views/InboxItemView.ts
import type { InboxItem } from '../../domain/inbox/InboxItem.js';
import { policyFor } from '../../domain/inbox/value-objects/ItemKind.js';

export interface InboxItemView {
  readonly id: string;
  readonly kind: string;
  readonly kindLabel: string;
  readonly title: string;
  readonly assignee: string;
  readonly priority: string;
  readonly status: string;
  readonly dueAt: string | null;
  readonly claimedBy: string | null;
  readonly completion: {
    readonly outcome: string;
    readonly note: string | null;
    readonly by: string;
    readonly at: string;
  } | null;
  readonly cancellation: { readonly reason: string; readonly by: string; readonly at: string } | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  /** Told, not inferred: the UI and any API client get the legal next moves from the source of truth. */
  readonly allowedOutcomes: readonly string[];
  readonly availableActions: readonly ('claim' | 'release' | 'complete' | 'cancel')[];
}

function actionsFor(item: InboxItem): InboxItemView['availableActions'] {
  switch (item.status) {
    case 'pending': return ['claim', 'complete', 'cancel'];
    case 'claimed': return ['release', 'complete', 'cancel'];
    default: return [];
  }
}

export function toView(item: InboxItem): InboxItemView {
  const s = item.snapshot();
  const policy = policyFor(s.kind);
  return {
    id: s.id,
    kind: s.kind,
    kindLabel: policy.label,
    title: s.title,
    assignee: s.assignee,
    priority: s.priority,
    status: s.status,
    dueAt: s.dueAt?.toISOString() ?? null,
    claimedBy: s.claimedBy,
    completion: s.completion
      ? {
          outcome: s.completion.outcome,
          note: s.completion.note,
          by: s.completion.by,
          at: s.completion.at.toISOString(),
        }
      : null,
    cancellation: s.cancellation
      ? { reason: s.cancellation.reason, by: s.cancellation.by, at: s.cancellation.at.toISOString() }
      : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    version: s.version,
    allowedOutcomes: policy.allowedOutcomes,
    availableActions: actionsFor(item),
  };
}
```

`allowedOutcomes` and `availableActions` are the small piece of API design that pays off most:
the UI in Stage 6 renders buttons from them instead of re-implementing the state machine in
HTML, and an external client can't drift from our rules.

## 2.4 Use cases

One class per operator intent. Each is: parse-already-done input → open a transaction → load →
call one aggregate method → save → publish → return a view. When a use case starts wanting a
second aggregate method or an `if`, that is a signal the rule belongs in the domain.

```ts
// src/application/use-cases/CreateInboxItem.ts
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
```

```ts
// src/application/use-cases/CompleteInboxItem.ts
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
```

That `if (item.hasPendingEvents)` is the whole reason `AggregateRoot` exposes it. Idempotency is
decided in the domain; the application layer just believes it.

```ts
// src/application/use-cases/ClaimInboxItem.ts
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
```

`ReleaseInboxItem` and `CancelInboxItem` are the same five lines with `item.release(actor, now)`
and `item.cancel(actor, reason, now)` respectively — written out in full in the repo, elided
here because repeating them adds nothing. (The near-duplication is deliberate: a shared
`TransitionUseCase<T>` base class would save ~8 lines and cost the ability to give each
transition its own command type and its own future authorisation rules. Recorded as tradeoff #9.)

```ts
// src/application/use-cases/GetInboxItem.ts
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
```

```ts
// src/application/use-cases/ListInboxItems.ts
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
        { statuses: query.statuses, assignee: query.assignee, kinds: query.kinds },
        { limit, ...(query.cursor === undefined ? {} : { cursor: query.cursor }) },
      );
      return { items: page.items.map(toView), nextCursor: page.nextCursor };
    });
  }
}
```

Reads go through the same unit of work. It costs one `BEGIN`/`COMMIT` on a read-only path, and
buys a single consistent way to reach storage plus a natural seam for a real read model later
(tradeoff #10). The `{ ...(cursor === undefined ? {} : { cursor }) }` shape is what
`exactOptionalPropertyTypes` demands, and it is honest: "absent" and "present but undefined"
are different queries.

## What this stage proves

- The domain is reachable and orchestrated without a single framework import.
- Atomicity of state + events is structural, not a thing to remember.
- Idempotent replay costs zero writes and zero events, end to end.
- Every use case is testable against in-memory adapters in milliseconds (Stage 5).

## Verify

```bash
npm run typecheck
npm run lint      # the import boundary rules from Stage 0 must stay green
```

Next: [Stage 3 — infrastructure adapters](04-stage-3-infrastructure-adapters.md).
