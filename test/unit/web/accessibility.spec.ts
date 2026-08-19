// @vitest-environment jsdom
/// <reference lib="dom" />
// The project's tsconfig omits the DOM lib on purpose, so server code can't reach for browser
// globals. This one test runs under jsdom and legitimately needs `document`; scope DOM to it.
import { describe, expect, it } from 'vitest';
import axe from 'axe-core';
import { inboxListPage } from '../../../src/api/web/views/inboxListPage.js';
import { itemDetailPage } from '../../../src/api/web/views/itemDetailPage.js';
import type { InboxItemView } from '../../../src/application/views/InboxItemView.js';

/**
 * Turns the accessibility checklist from a plan into evidence: renders each server-rendered page
 * and runs axe-core against it. `color-contrast` is disabled because jsdom does no layout or
 * painting, so axe cannot evaluate it here — that (and a real screen-reader pass) is the part a
 * checklist still can't replace, and is called out in the README.
 */
async function violations(html: string): Promise<axe.Result[]> {
  // Load the complete document (doctype, <html lang>, <head>, <body>) so axe evaluates the real
  // markup the server sends, not a fragment.
  document.open();
  document.write(html);
  document.close();
  const results = await axe.run(document, {
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  });
  return results.violations;
}

const pendingExpense: InboxItemView = {
  id: '7b2f1c34-9a5e-4f21-8c0d-1e2f3a4b5c6d',
  kind: 'approve_expense',
  kindLabel: 'Approve an expense',
  title: 'Expense EXP-1042 — $420 travel to Lisbon',
  assignee: 'ana.silva',
  priority: 'high',
  status: 'pending',
  dueAt: null,
  claimedBy: null,
  completion: null,
  cancellation: null,
  createdAt: '2026-08-18T09:00:00.000Z',
  updatedAt: '2026-08-18T09:00:00.000Z',
  version: 0,
  allowedOutcomes: ['approved', 'rejected'],
  availableActions: ['claim', 'complete', 'cancel'],
};

const describeViolations = (vs: axe.Result[]) =>
  vs.map((v) => `${v.id}: ${v.nodes.length} node(s)`).join('; ');

describe('web page accessibility (axe-core)', () => {
  it('the inbox list page has no axe violations', async () => {
    const html = inboxListPage({
      result: { items: [pendingExpense], nextCursor: null },
      actor: 'ana.silva',
      status: 'open',
    });
    const vs = await violations(html);
    expect(vs, describeViolations(vs)).toEqual([]);
  });

  it('the empty inbox list page has no axe violations', async () => {
    const html = inboxListPage({
      result: { items: [], nextCursor: null },
      actor: 'ana.silva',
      status: 'completed',
    });
    const vs = await violations(html);
    expect(vs, describeViolations(vs)).toEqual([]);
  });

  it('the item detail page (with the decision + cancel forms) has no axe violations', async () => {
    const html = itemDetailPage({
      item: pendingExpense,
      actor: 'ana.silva',
      idempotencyKey: 'web-test-key-0001',
    });
    const vs = await violations(html);
    expect(vs, describeViolations(vs)).toEqual([]);
  });

  it('a completed item detail page (recorded outcome, no form) has no axe violations', async () => {
    const completed: InboxItemView = {
      ...pendingExpense,
      status: 'completed',
      claimedBy: 'ana.silva',
      completion: { outcome: 'approved', note: 'ok', by: 'ana.silva', at: '2026-08-18T09:05:00.000Z' },
      version: 2,
      availableActions: [],
    };
    const html = itemDetailPage({ item: completed, actor: 'ana.silva', idempotencyKey: 'web-test-key-0002' });
    const vs = await violations(html);
    expect(vs, describeViolations(vs)).toEqual([]);
  });
});
