import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildHttpApp } from '../../../src/api/http/buildHttpApp.js';
import { harness } from '../../support/fixtures.js';

function appFor(useCases: Parameters<typeof buildHttpApp>[0]['useCases']): FastifyInstance {
  return buildHttpApp({
    useCases,
    health: { checkReadiness: async () => undefined, version: 'test' },
    logger: false,
  });
}

const CREATE = {
  method: 'POST' as const,
  url: '/api/inbox-items',
  payload: { kind: 'approve_expense', title: 'Expense EXP-1042', assignee: 'ana.silva' },
};

describe('inbox HTTP API', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = appFor(harness().useCases);
  });

  const created = async () => (await app.inject(CREATE)).json<{ id: string }>();

  it('creates with 201 and a Location header', async () => {
    const response = await app.inject(CREATE);
    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toMatch(/^\/api\/inbox-items\/[0-9a-f-]{36}$/);
    expect(response.json()).toMatchObject({ status: 'pending', priority: 'normal' });
  });

  it('returns field-level problem+json on a malformed body', async () => {
    const response = await app.inject({ ...CREATE, payload: { kind: 'nope', title: '' } });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    const problem = response.json();
    expect(problem.code).toBe('REQUEST_VALIDATION_ERROR');
    expect(problem.errors.map((e: { field: string }) => e.field)).toContain('kind');
    expect(problem.requestId).toBeTruthy();
  });

  it('requires the Idempotency-Key header to complete', async () => {
    const { id } = await created();
    const response = await app.inject({
      method: 'POST',
      url: `/api/inbox-items/${id}/completion`,
      headers: { 'x-actor-id': 'ana.silva' },
      payload: { outcome: 'approved' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('is idempotent across identical requests and 409s on a new key', async () => {
    const { id } = await created();
    const complete = (key: string) =>
      app.inject({
        method: 'POST',
        url: `/api/inbox-items/${id}/completion`,
        headers: { 'x-actor-id': 'ana.silva', 'idempotency-key': key },
        payload: { outcome: 'approved' },
      });

    const first = await complete('form-abc-123');
    const replay = await complete('form-abc-123');
    const second = await complete('form-xyz-789');

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json()); // identical body, including version
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('ITEM_COMPLETION_CONFLICT');
  });

  it('403s when someone else holds the item', async () => {
    const { id } = await created();
    await app.inject({ method: 'POST', url: `/api/inbox-items/${id}/claim`, headers: { 'x-actor-id': 'ana.silva' } });
    const response = await app.inject({
      method: 'POST',
      url: `/api/inbox-items/${id}/completion`,
      headers: { 'x-actor-id': 'ben.oyelaran', 'idempotency-key': 'form-other-1' },
      payload: { outcome: 'approved' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('ITEM_NOT_ASSIGNED_TO_ACTOR');
  });

  it('422s with an actionable message when the outcome breaks the kind policy', async () => {
    const { id } = await created();
    const response = await app.inject({
      method: 'POST',
      url: `/api/inbox-items/${id}/completion`,
      headers: { 'x-actor-id': 'ana.silva', 'idempotency-key': 'form-reject-1' },
      payload: { outcome: 'rejected' }, // no note
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().detail).toContain('a note is required');
  });

  it('echoes an inbound x-request-id for cross-service correlation', async () => {
    const response = await app.inject({ ...CREATE, headers: { 'x-request-id': 'trace-42' } });
    expect(response.headers['x-request-id']).toBe('trace-42');
  });
});
