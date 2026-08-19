import { z } from 'zod';
import { NOTE_MAX } from '../../../domain/inbox/value-objects/CompletionNote.js';
import { ITEM_KINDS } from '../../../domain/inbox/value-objects/ItemKind.js';
import { ITEM_STATUSES } from '../../../domain/inbox/value-objects/ItemStatus.js';
import { OUTCOMES } from '../../../domain/inbox/value-objects/Outcome.js';
import { PRIORITIES } from '../../../domain/inbox/value-objects/Priority.js';
import { TITLE_MAX } from '../../../domain/inbox/value-objects/Title.js';
import { MAX_PAGE_SIZE } from '../../../application/use-cases/ListInboxItems.js';

/** Comma-separated repeated query values: ?status=pending,claimed */
const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((raw) => raw.split(',').map((part) => part.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1))
    .optional();

export const ItemIdParams = z.object({ id: z.string().uuid() });

export const CreateItemBody = z.object({
  kind: z.enum(ITEM_KINDS),
  title: z.string().min(1).max(TITLE_MAX),
  assignee: z.string().min(2).max(64),
  priority: z.enum(PRIORITIES).default('normal'),
  dueAt: z.string().datetime({ offset: true }).nullish(),
});

export const ListItemsQuery = z.object({
  status: csv(ITEM_STATUSES),
  kind: csv(ITEM_KINDS),
  assignee: z.string().min(2).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: z.string().min(1).optional(),
});

export const CompleteItemBody = z.object({
  outcome: z.enum(OUTCOMES),
  note: z.string().max(NOTE_MAX).nullish(),
});

export const CancelItemBody = z.object({
  reason: z.string().min(1).max(500),
});

export const ActorHeader = z.object({
  'x-actor-id': z.string().min(2).max(64, 'X-Actor-Id header is required'),
});

export const IdempotencyHeader = z.object({
  'idempotency-key': z.string().min(8).max(128, 'Idempotency-Key header is required'),
});

export type CreateItemBody = z.infer<typeof CreateItemBody>;
export type ListItemsQuery = z.infer<typeof ListItemsQuery>;
export type CompleteItemBody = z.infer<typeof CompleteItemBody>;
