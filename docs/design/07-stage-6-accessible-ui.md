# Stage 6 — The Operator UI (Second Driving Adapter)

> **Goal:** a usable, accessible inbox that works with JavaScript disabled and shares 100% of its
> logic with the JSON API — proving the hexagon rather than asserting it.
> **In the hour:** yes, in minimal form (~5 min for the list + complete form; the detail page and
> the flash/focus polish are the tail end).

Adds one runtime dependency: `@fastify/formbody` (parses `application/x-www-form-urlencoded`, so
plain HTML forms work without a client-side fetch layer).

## Files added

```
src/api/web/escape.ts
src/api/web/messages.ts
src/api/web/views/{layout,inboxListPage,itemDetailPage}.ts
src/api/web/routes/registerWebRoutes.ts
```

---

## 6.1 Why server-rendered HTML

A SPA here would mean re-implementing the state machine in the client (which buttons are legal),
re-implementing validation, and shipping a build toolchain — for a tool whose interaction is
"read four rows, click Approve". Server rendering makes correctness the default: the browser
handles focus, keyboard, and back/forward for free, and the "which actions are legal" question is
answered by `availableActions` from Stage 2, never re-derived.

The deeper reason is architectural: this adapter exists to demonstrate that a second, very
different caller needs **zero** new business code. No use case changed. No port changed. The
domain does not know HTML exists.

```
                            ┌─────────────────────────┐
  JSON client ─────────────►│  src/api/http           │───┐
                            └─────────────────────────┘   │   same seven use cases,
                            ┌─────────────────────────┐   ├──►same domain, same rules,
  Browser (no JS) ─────────►│  src/api/web            │───┘   same metrics
                            └─────────────────────────┘
```

## 6.2 Escaping — the one security-relevant helper

```ts
// src/api/web/escape.ts
const ENTITIES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

/** Every interpolation in every template goes through this. Titles and notes are user input. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]!);
}

/** For attribute values built from user data (ids, cursors). */
export function attr(value: unknown): string {
  return esc(value);
}
```

Tagged-template auto-escaping would be nicer and is what I would add next; with hand-rolled
templates the discipline is "no bare `${}` in HTML", enforced by review. Called out as a known
sharp edge rather than left implicit — a `title` field is attacker-controlled the moment an
upstream service creates items on a user's behalf.

## 6.3 Human-readable error messages

The API returns machine `code`s; the UI needs sentences. One mapping table, so an unmapped code
degrades to something honest instead of leaking an internal message.

```ts
// src/api/web/messages.ts
export const FLASH: Record<string, { tone: 'success' | 'error'; text: string }> = {
  completed:   { tone: 'success', text: 'Action completed. Thanks — the requester has been notified.' },
  claimed:     { tone: 'success', text: 'You have claimed this item.' },
  released:    { tone: 'success', text: 'Item released back to the queue.' },
  cancelled:   { tone: 'success', text: 'Item cancelled.' },

  ITEM_COMPLETION_CONFLICT:  { tone: 'error', text: 'This item was already completed. The recorded outcome is shown below.' },
  ITEM_STATE_CONFLICT:       { tone: 'error', text: 'This item is already closed, so it cannot be changed.' },
  ITEM_NOT_ASSIGNED_TO_ACTOR:{ tone: 'error', text: 'Someone else is working on this item.' },
  ITEM_OUTCOME_NOT_ALLOWED:  { tone: 'error', text: 'That outcome needs a note explaining the decision.' },
  CONCURRENCY_CONFLICT:      { tone: 'error', text: 'This item changed while you were reading it. It has been reloaded.' },
  ITEM_NOT_FOUND:            { tone: 'error', text: 'That item no longer exists.' },
  VALIDATION_ERROR:          { tone: 'error', text: 'Please check the form and try again.' },
};

export function flashFor(code: string | undefined): { tone: 'success' | 'error'; text: string } | null {
  if (!code) return null;
  return FLASH[code] ?? { tone: 'error', text: 'Something went wrong. Please try again.' };
}
```

Note `ITEM_COMPLETION_CONFLICT`'s wording: it tells the operator what *is* true rather than
scolding them. A double-click is the most likely cause, and the page they land on shows the
recorded outcome, so the message is reassuring instead of alarming.

## 6.4 Layout

```ts
// src/api/web/views/layout.ts
import { esc } from '../escape.js';
import { flashFor } from '../messages.js';

export function layout(opts: { title: string; flashCode?: string | undefined; body: string }): string {
  const flash = flashFor(opts.flashCode);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title)} · Workflow Inbox</title>
  <style>
    :root { color-scheme: light dark; --gap: 1rem; --line: color-mix(in srgb, currentColor 20%, transparent); }
    body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 60rem; padding: var(--gap); }
    /* Never remove the focus ring; make it unmissable instead. */
    :focus-visible { outline: 3px solid Highlight; outline-offset: 2px; }
    table { border-collapse: collapse; width: 100%; }
    caption { text-align: left; font-weight: 600; padding-block: 0.5rem; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--line); }
    .status { display: inline-block; padding: 0.1rem 0.5rem; border: 1px solid var(--line); border-radius: 999px; font-size: 0.85rem; }
    .flash { padding: 0.75rem 1rem; border-left: 4px solid currentColor; margin-block: var(--gap); }
    .flash[data-tone="error"] { color: #b3261e; }
    .flash[data-tone="success"] { color: #1b5e20; }
    button { font: inherit; padding: 0.4rem 0.9rem; cursor: pointer; }
    fieldset { border: 1px solid var(--line); margin-block: var(--gap); }
    .hint { font-size: 0.875rem; opacity: 0.8; }
    @media (prefers-reduced-motion: no-preference) { .flash { transition: opacity 0.2s; } }
  </style>
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  <header><strong>Workflow Inbox</strong></header>

  <!-- Announced by screen readers after a redirect, without stealing focus. -->
  <div role="status" aria-live="polite">
    ${flash ? `<p class="flash" data-tone="${flash.tone}">${esc(flash.text)}</p>` : ''}
  </div>

  <main id="main" tabindex="-1">
    ${opts.body}
  </main>
</body>
</html>`;
}
```

`role="status"` + `aria-live="polite"` is how a sighted-user flash message becomes equally
available to a screen-reader user: after the post-redirect-get the region is announced without
interrupting, and `main` is focusable (`tabindex="-1"`) so the browser lands somewhere meaningful
rather than at the top of the document.

## 6.5 List page

```ts
// src/api/web/views/inboxListPage.ts
import type { InboxItemListResult } from '../../../application/use-cases/ListInboxItems.js';
import { attr, esc } from '../escape.js';
import { layout } from './layout.js';

const DUE_FORMAT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function inboxListPage(opts: {
  result: InboxItemListResult;
  actor: string;
  status: string;
  flashCode?: string | undefined;
}): string {
  const { items, nextCursor } = opts.result;

  const rows = items
    .map(
      (item) => `
      <tr>
        <th scope="row"><a href="/items/${attr(item.id)}">${esc(item.title)}</a></th>
        <td>${esc(item.kindLabel)}</td>
        <td>${esc(item.priority)}</td>
        <td><span class="status">${esc(item.status)}</span></td>
        <td>${item.dueAt ? `<time datetime="${attr(item.dueAt)}">${esc(DUE_FORMAT.format(new Date(item.dueAt)))}</time>` : '—'}</td>
        <td>${
          item.availableActions.includes('complete')
            ? `<a href="/items/${attr(item.id)}">Open<span class="visually-hidden"> ${esc(item.title)}</span></a>`
            : esc(item.completion?.outcome ?? item.status)
        }</td>
      </tr>`,
    )
    .join('');

  const body = `
    <h1>Pending actions</h1>
    <p class="hint">Signed in as <strong>${esc(opts.actor)}</strong>.</p>

    <form method="get" action="/">
      <fieldset>
        <legend>Filter</legend>
        <label for="status">Status</label>
        <select id="status" name="status">
          ${['open', 'pending', 'claimed', 'completed', 'cancelled']
            .map((s) => `<option value="${attr(s)}"${s === opts.status ? ' selected' : ''}>${esc(s)}</option>`)
            .join('')}
        </select>
        <button type="submit">Apply</button>
      </fieldset>
    </form>

    ${
      items.length === 0
        ? `<p>Nothing needs your attention right now.</p>`
        : `<table>
             <caption>${items.length} item${items.length === 1 ? '' : 's'}${nextCursor ? ' (more available)' : ''}</caption>
             <thead>
               <tr>
                 <th scope="col">Action</th><th scope="col">Type</th><th scope="col">Priority</th>
                 <th scope="col">Status</th><th scope="col">Due</th><th scope="col"></th>
               </tr>
             </thead>
             <tbody>${rows}</tbody>
           </table>`
    }

    ${nextCursor ? `<p><a href="/?status=${attr(opts.status)}&cursor=${attr(nextCursor)}">Next page</a></p>` : ''}
  `;

  return layout({ title: 'Pending actions', flashCode: opts.flashCode, body });
}
```

Details that matter for real users: the item title is the row's `<th scope="row">`, so a screen
reader announces "Deploy payments-api v2.14.0 — Review a deployment — urgent" instead of six
unlabelled cells; `<caption>` states the count and whether more exist; the "Open" link carries a
visually hidden item name so a link list is not six identical "Open"s; and `<time datetime>`
gives the machine-readable value beside the localised one.

## 6.6 Detail page — where completion happens

```ts
// src/api/web/views/itemDetailPage.ts
import type { InboxItemView } from '../../../application/views/InboxItemView.js';
import { attr, esc } from '../escape.js';
import { layout } from './layout.js';

const OUTCOME_LABEL: Record<string, string> = {
  approved: 'Approve', rejected: 'Reject', done: 'Mark as done',
};

export function itemDetailPage(opts: {
  item: InboxItemView;
  actor: string;
  /** Stable per attempt: survives a validation round-trip so a retry is the SAME attempt. */
  idempotencyKey: string;
  flashCode?: string | undefined;
}): string {
  const { item } = opts;
  const canComplete = item.availableActions.includes('complete');

  const outcomes = item.allowedOutcomes
    .map(
      (o, index) => `
      <label>
        <input type="radio" name="outcome" value="${attr(o)}" ${index === 0 ? 'required' : ''}>
        ${esc(OUTCOME_LABEL[o] ?? o)}
      </label>`,
    )
    .join('');

  const completeForm = `
    <form method="post" action="/items/${attr(item.id)}/complete">
      <input type="hidden" name="idempotencyKey" value="${attr(opts.idempotencyKey)}">
      <fieldset>
        <legend>Decision</legend>
        ${outcomes}
        <p>
          <label for="note">Note ${item.kind.startsWith('approve') || item.kind.startsWith('review') ? '<span class="hint">(required when rejecting)</span>' : '<span class="hint">(optional)</span>'}</label><br>
          <textarea id="note" name="note" rows="3" cols="60" maxlength="1000"
                    aria-describedby="note-hint"></textarea>
          <span id="note-hint" class="hint">Recorded in the audit trail and visible to the requester.</span>
        </p>
        <button type="submit">Submit decision</button>
      </fieldset>
    </form>

    <form method="post" action="/items/${attr(item.id)}/${item.status === 'claimed' ? 'release' : 'claim'}">
      <button type="submit">${item.status === 'claimed' ? 'Release to queue' : 'Claim this item'}</button>
    </form>`;

  const record = item.completion
    ? `<h2>Recorded outcome</h2>
       <dl>
         <dt>Outcome</dt><dd>${esc(item.completion.outcome)}</dd>
         <dt>By</dt><dd>${esc(item.completion.by)}</dd>
         <dt>At</dt><dd><time datetime="${attr(item.completion.at)}">${esc(item.completion.at)}</time></dd>
         ${item.completion.note ? `<dt>Note</dt><dd>${esc(item.completion.note)}</dd>` : ''}
       </dl>`
    : item.cancellation
      ? `<h2>Cancelled</h2><p>${esc(item.cancellation.reason)} — ${esc(item.cancellation.by)}</p>`
      : '';

  const body = `
    <nav><a href="/">← All pending actions</a></nav>
    <h1>${esc(item.title)}</h1>
    <dl>
      <dt>Type</dt><dd>${esc(item.kindLabel)}</dd>
      <dt>Status</dt><dd><span class="status">${esc(item.status)}</span></dd>
      <dt>Assigned to</dt><dd>${esc(item.assignee)}</dd>
      ${item.claimedBy ? `<dt>Held by</dt><dd>${esc(item.claimedBy)}</dd>` : ''}
    </dl>
    ${canComplete ? completeForm : ''}
    ${record}
  `;

  return layout({ title: item.title, flashCode: opts.flashCode, body });
}
```

The radio buttons are generated from `item.allowedOutcomes`, which came from the domain's kind
policy. Adding a new kind never touches this file — and the UI can never offer an outcome the
domain will refuse.

## 6.7 Routes — post/redirect/get, with the idempotency key round-tripped

```ts
// src/api/web/routes/registerWebRoutes.ts
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

/** Assumption #1 again, in the UI: identity would come from a session cookie. */
const DEMO_ACTOR = 'ana.silva';
const actorOf = (request: FastifyRequest) =>
  actorId((request.headers['x-actor-id'] as string | undefined) ?? DEMO_ACTOR);

const OPEN = ['pending', 'claimed'] as const;

export async function registerWebRoutes(app: FastifyInstance, useCases: UseCases): Promise<void> {
  await app.register(formbody);

  app.get('/', async (request, reply) => {
    const q = request.query as { status?: string; cursor?: string; flash?: string };
    const status = q.status ?? 'open';
    const result = await useCases.listInboxItems.execute({
      statuses: status === 'open' ? OPEN : ([status] as never),
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
```

Three deliberate choices in these ~60 lines:

- **303 after every POST.** The browser then issues a GET, so refresh and back never re-submit a
  decision. Combined with the idempotency key, a double-submit is safe twice over — once by
  protocol, once by domain rule.
- **The key lives in the form, not the request.** It is minted when the page is rendered, so both
  halves of a double-click carry the same value and the second is a no-op. A key minted per HTTP
  request would defeat the entire mechanism — the most common way idempotency is implemented and
  silently broken.
- **`cache-control: no-store`.** Otherwise the back button shows a completed item as pending and
  the operator "completes" it again, which is a 409 they did nothing to deserve.

## 6.8 Optional progressive enhancement

Everything above works with JavaScript off. The one enhancement worth ~10 lines:

```html
<script type="module">
  // Guard against a double-click while the round-trip is in flight. The server is already
  // safe; this just removes the confusing second spinner.
  for (const form of document.querySelectorAll('form[method="post"]')) {
    form.addEventListener('submit', () => {
      for (const button of form.querySelectorAll('button[type="submit"]')) {
        button.disabled = true;
        button.textContent = 'Working…';
      }
    }, { once: true });
  }
</script>
```

Note the framing: the script improves *feedback*, it is not load-bearing for correctness. That
distinction is what lets it be optional.

## 6.9 Accessibility checklist

| Requirement | How it is met |
| --- | --- |
| Keyboard-only operation | Native form controls throughout; no custom widgets, no key handlers |
| Visible focus | `:focus-visible { outline: 3px solid Highlight }` — never removed |
| Landmarks & skip link | `<header>`, `<main id="main">`, "Skip to content" first in tab order |
| Post-action announcement | `role="status" aria-live="polite"` region, populated after the 303 |
| Focus destination | `<main tabindex="-1">` so the post-redirect page starts at the content |
| Table semantics | `<caption>`, `<th scope="col">`, item title as `<th scope="row">` |
| Labelled inputs | Every control has a `<label for>`; the textarea uses `aria-describedby` for the hint |
| Distinguishable link text | Row links carry a visually hidden item title |
| Not colour-alone | Status is a text pill; flash tone is text plus a border, not hue alone |
| Contrast & dark mode | `color-scheme: light dark` with system colours (`Highlight`) |
| Reduced motion | Transitions only under `prefers-reduced-motion: no-preference` |
| Localised + machine time | `<time datetime>` beside `Intl.DateTimeFormat` output |

**Not done, and I would not ship without it:** a real audit with a screen reader (NVDA/VoiceOver)
and an axe pass in CI. A checklist is a plan, not evidence — the `.visually-hidden` utility class
referenced above also needs adding to the stylesheet, which is exactly the kind of gap an
automated pass catches.

## What this stage proves

- A second driving adapter, radically different from the first, needed **zero** changes to the
  domain, ports, or use cases — the architecture claim from Stage 0, demonstrated.
- Double-submit safety is enforced twice, independently (PRG + domain idempotency).
- Accessibility came from choosing boring, native building blocks rather than from remediation.

## Verify

```bash
npm run dev
open http://localhost:3000/
# Click Approve twice quickly → one approval, second is a no-op, no error page.
# Disable JavaScript entirely → identical behaviour.
# Tab through: skip link → filter → rows → decision form. Focus is visible at every step.
```

Next: [the project README and tradeoffs](08-project-readme-and-tradeoffs.md).
