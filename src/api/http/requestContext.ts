import type { FastifyRequest } from 'fastify';
import { actorId, type ActorId } from '../../domain/inbox/value-objects/ActorId.js';
import { idempotencyKey, type IdempotencyKey } from '../../domain/inbox/value-objects/IdempotencyKey.js';
import { ActorHeader, IdempotencyHeader } from './contracts/inboxItemContracts.js';

/**
 * The single place identity enters the system. Replacing this with a verified JWT subject is
 * a change to this function and nothing else — that is the whole reason it exists.
 */
export function actorFrom(request: FastifyRequest): ActorId {
  const headers = ActorHeader.parse(request.headers);
  return actorId(headers['x-actor-id']);
}

export function idempotencyKeyFrom(request: FastifyRequest): IdempotencyKey {
  const headers = IdempotencyHeader.parse(request.headers);
  return idempotencyKey(headers['idempotency-key']);
}
