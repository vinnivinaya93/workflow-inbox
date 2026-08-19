import formbody from '@fastify/formbody';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { UseCases } from '../../../composition/container.js';
import { ApplicationError } from '../../../application/errors.js';
import { DomainError } from '../../../domain/shared/errors.js';
import { actorId } from '../../../domain/inbox/value-objects/ActorId.js';
import { completionNote } from '../../../domain/inbox/value-objects/CompletionNote.js';
import { idempotencyKey } from '../../../domain/inbox/value-objects/IdempotencyKey.js';
import { inboxItemId } from '../../../domain/inbox/value-objects/InboxItemId.js';
import { outcome } from '../../../domain/inbox/value-objects/Outcome.js';
import { inboxListPage } from '../views/inboxListPage.js';
import { itemDetailPage } from '../views/itemDetailPage.js';

/** Assumption: identity would come from a session cookie once real auth exists. */
const DEMO_ACTOR = 'ana.silva';
const actorOf = (request: FastifyRequest) =>
  actorId((request.headers['x-actor-id'] as string | undefined) ?? DEMO_ACTOR);

const OPEN = ['pending', 'claimed'] as const;
const KNOWN_STATUSES = ['pending', 'claimed', 'completed', 'cancelled'] as const;

export async function registerWebRoutes(app: FastifyInstance, useCases: UseCases): Promise<void> {
  await app.register(formbody);

  app.get('/', async (request, reply) => {
    const q = request.query as { status?: string; cursor?: string; flash?: string };
    const status = q.status ?? 'open';
    const statuses = status === 'open'
      ? OPEN
      : (KNOWN_STATUSES as readonly string[]).includes(status)
        ? [status as (typeof KNOWN_STATUSES)[number]]
        : OPEN;
    const result = await useCases.listInboxItems.execute({
      statuses,
      ...(q.cursor ? { cursor: q.cursor } : {}),
      limit: 25,
    });
    return html(reply, inboxListPage({ result, actor: actorOf(request), status, flashCode: q.flash }));
  });

  app.get('/items/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { flash?: string; key?: string };
    const item = await useCases.getInboxItem.execute(inboxItemId(id));
    return html(
      reply,
      itemDetailPage({
        item,
        actor: actorOf(request),
        // Reuse the key from a failed attempt so a corrected resubmit is the same attempt.
        idempotencyKey: q.key ?? `web-${randomUUID()}`,
        flashCode: q.flash,
      }),
    );
  });

  app.post('/items/:id/complete', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { outcome?: string; note?: string; idempotencyKey?: string };
    const key = body.idempotencyKey ?? `web-${randomUUID()}`;

    try {
      await useCases.completeInboxItem.execute({
        id: inboxItemId(id),
        actor: actorOf(request),
        outcome: outcome(body.outcome ?? ''),
        note: body.note?.trim() ? completionNote(body.note) : null,
        idempotencyKey: idempotencyKey(key),
      });
      return reply.redirect(`/?flash=completed`, 303);
    } catch (error) {
      // Send the user back to the form with the SAME key, so fixing a missing note and
      // resubmitting is a retry of one attempt rather than a second one that would 409.
      return reply.redirect(
        `/items/${encodeURIComponent(id)}?flash=${codeOf(error)}&key=${encodeURIComponent(key)}`,
        303,
      );
    }
  });

  // claim and release share one shape, so they share one helper.
  const transition = (
    path: 'claim' | 'release',
    run: (id: string, actor: ReturnType<typeof actorOf>) => Promise<unknown>,
    okFlash: string,
  ) =>
    app.post(`/items/:id/${path}`, async (request, reply) => {
      const { id } = request.params as { id: string };
      const target = `/items/${encodeURIComponent(id)}`;
      try {
        await run(id, actorOf(request));
        return reply.redirect(`${target}?flash=${okFlash}`, 303);
      } catch (error) {
        return reply.redirect(`${target}?flash=${codeOf(error)}`, 303);
      }
    });

  transition('claim', (id, actor) => useCases.claimInboxItem.execute({ id: inboxItemId(id), actor }), 'claimed');
  transition('release', (id, actor) => useCases.releaseInboxItem.execute({ id: inboxItemId(id), actor }), 'released');
}

function html(reply: FastifyReply, body: string): FastifyReply {
  return reply
    .type('text/html; charset=utf-8')
    .header('cache-control', 'no-store') // an inbox must never be served stale from history
    .send(body);
}

function codeOf(error: unknown): string {
  if (error instanceof DomainError || error instanceof ApplicationError) return error.code;
  return 'UNKNOWN';
}
