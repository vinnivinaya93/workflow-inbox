import type { FastifyInstance } from 'fastify';
import { completionNote } from '../../../domain/inbox/value-objects/CompletionNote.js';
import { inboxItemId } from '../../../domain/inbox/value-objects/InboxItemId.js';
import { actorId } from '../../../domain/inbox/value-objects/ActorId.js';
import { outcome } from '../../../domain/inbox/value-objects/Outcome.js';
import { title } from '../../../domain/inbox/value-objects/Title.js';
import type { UseCases } from '../../../composition/container.js';
import {
  CancelItemBody, CompleteItemBody, CreateItemBody, ItemIdParams, ListItemsQuery,
} from '../contracts/inboxItemContracts.js';
import { actorFrom, idempotencyKeyFrom } from '../requestContext.js';

export function registerInboxItemRoutes(app: FastifyInstance, useCases: UseCases): void {
  app.post('/api/inbox-items', async (request, reply) => {
    const body = CreateItemBody.parse(request.body);
    const view = await useCases.createInboxItem.execute({
      kind: body.kind,
      title: title(body.title),
      assignee: actorId(body.assignee),
      priority: body.priority,
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
    });
    return reply.code(201).header('location', `/api/inbox-items/${view.id}`).send(view);
  });

  app.get('/api/inbox-items', async (request, reply) => {
    const query = ListItemsQuery.parse(request.query);
    const result = await useCases.listInboxItems.execute({
      ...(query.status ? { statuses: query.status } : {}),
      ...(query.kind ? { kinds: query.kind } : {}),
      ...(query.assignee ? { assignee: actorId(query.assignee) } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit ?? 25,
    });
    return reply.send(result);
  });

  app.get('/api/inbox-items/:id', async (request, reply) => {
    const { id } = ItemIdParams.parse(request.params);
    return reply.send(await useCases.getInboxItem.execute(inboxItemId(id)));
  });

  app.post('/api/inbox-items/:id/claim', async (request, reply) => {
    const { id } = ItemIdParams.parse(request.params);
    return reply.send(
      await useCases.claimInboxItem.execute({ id: inboxItemId(id), actor: actorFrom(request) }),
    );
  });

  app.post('/api/inbox-items/:id/release', async (request, reply) => {
    const { id } = ItemIdParams.parse(request.params);
    return reply.send(
      await useCases.releaseInboxItem.execute({ id: inboxItemId(id), actor: actorFrom(request) }),
    );
  });

  app.post('/api/inbox-items/:id/completion', async (request, reply) => {
    const { id } = ItemIdParams.parse(request.params);
    const body = CompleteItemBody.parse(request.body ?? {});
    const view = await useCases.completeInboxItem.execute({
      id: inboxItemId(id),
      actor: actorFrom(request),
      outcome: outcome(body.outcome),
      note: body.note ? completionNote(body.note) : null,
      idempotencyKey: idempotencyKeyFrom(request),
    });
    return reply.send(view);
  });

  app.post('/api/inbox-items/:id/cancellation', async (request, reply) => {
    const { id } = ItemIdParams.parse(request.params);
    const body = CancelItemBody.parse(request.body);
    return reply.send(
      await useCases.cancelInboxItem.execute({
        id: inboxItemId(id), actor: actorFrom(request), reason: body.reason,
      }),
    );
  });
}
