import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OpenApiGeneratorV31, OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import * as c from '../src/api/http/contracts/inboxItemContracts.js';

extendZodWithOpenApi(z);
const registry = new OpenAPIRegistry();

registry.registerPath({
  method: 'post',
  path: '/api/inbox-items',
  summary: 'Create an inbox item',
  request: { body: { content: { 'application/json': { schema: c.CreateItemBody } } } },
  responses: {
    201: { description: 'The created item' },
    400: { description: 'Validation error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/inbox-items',
  summary: 'List inbox items (keyset pagination)',
  request: { query: c.ListItemsQuery },
  responses: { 200: { description: 'A page of items' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/inbox-items/{id}',
  summary: 'Get one inbox item',
  request: { params: c.ItemIdParams },
  responses: { 200: { description: 'The item' }, 404: { description: 'Not found' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/inbox-items/{id}/claim',
  summary: 'Claim an inbox item (idempotent for the same actor)',
  request: { params: c.ItemIdParams, headers: [c.ActorHeader] },
  responses: {
    200: { description: 'The updated item' },
    403: { description: 'Actor is not the assignee' },
    409: { description: 'Terminal state' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/inbox-items/{id}/release',
  summary: 'Release a claimed inbox item back to the queue',
  request: { params: c.ItemIdParams, headers: [c.ActorHeader] },
  responses: {
    200: { description: 'The updated item' },
    403: { description: 'Actor does not hold the item' },
    409: { description: 'Terminal state' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/inbox-items/{id}/completion',
  summary: 'Complete an inbox item (idempotent)',
  request: {
    params: c.ItemIdParams,
    headers: [c.ActorHeader, c.IdempotencyHeader],
    body: { content: { 'application/json': { schema: c.CompleteItemBody } } },
  },
  responses: {
    200: { description: 'The updated item' },
    403: { description: 'Actor does not hold the item' },
    409: { description: 'Terminal state, or already completed under another key' },
    422: { description: 'Outcome not allowed for this kind' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/inbox-items/{id}/cancellation',
  summary: 'Cancel an inbox item',
  request: {
    params: c.ItemIdParams,
    headers: [c.ActorHeader],
    body: { content: { 'application/json': { schema: c.CancelItemBody } } },
  },
  responses: {
    200: { description: 'The updated item' },
    403: { description: 'Actor does not hold the item' },
    409: { description: 'Terminal state' },
  },
});

const doc = new OpenApiGeneratorV31(registry.definitions).generateDocument({
  openapi: '3.1.0',
  info: { title: 'Workflow Inbox API', version: '1.0.0' },
});

const yaml = toYaml(doc);
const target = fileURLToPath(new URL('../contracts/openapi.yaml', import.meta.url));

if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current !== yaml) {
    console.error('contracts/openapi.yaml is stale — run `npm run openapi`');
    process.exit(1);
  }
  console.log('contracts/openapi.yaml is up to date');
} else {
  writeFileSync(target, yaml);
  console.log(`wrote ${target}`);
}

/** A tiny, dependency-free YAML serialiser — enough for a plain-data OpenAPI document. */
function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);

  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return yamlString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((item) => {
        const rendered = toYaml(item, indent + 1);
        return isScalar(item)
          ? `${pad}- ${rendered}`
          : `${pad}-${rendered.startsWith('\n') ? '' : ' '}${rendered.trimStart()}`;
      })
      .join('\n');
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    return entries
      .map(([key, v]) => {
        const rendered = toYaml(v, indent + 1);
        if (isScalar(v) || (Array.isArray(v) && v.length === 0) || (isPlainObject(v) && Object.keys(v).length === 0)) {
          return `${pad}${yamlKey(key)}: ${rendered}`;
        }
        return `${pad}${yamlKey(key)}:\n${rendered}`;
      })
      .join('\n');
  }

  return String(value);
}

function isScalar(value: unknown): boolean {
  return value === null || value === undefined || typeof value !== 'object';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function yamlKey(key: string): string {
  return /^[A-Za-z0-9_]+$/.test(key) ? key : yamlString(key);
}

function yamlString(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9 _./-]+$/.test(value) && !/^(true|false|null|~)$/i.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}
