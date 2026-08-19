# Screen recording script

The take-home doc lists a 5–10 minute walkthrough as optional. I have no audio/video recording
capability, so I can't produce the recording itself — but here is a full narration script, timed
and ready to read straight into one. Every command and click path below has actually been run
against this codebase during verification, not written speculatively.

Setup before recording: `npm run dev` in one terminal, a browser at `http://localhost:3000`, and
a second terminal for curl. `jq` makes the curl output readable; drop the `| jq` pipes if you
don't have it installed.

---

## 0:00–0:15 — Cold open

> "This is Workflow Inbox — an internal operations tool where a person's pending actions live:
> approve an expense, review a deployment, upload documentation, complete onboarding. I built it
> for the take-home exercise, Option 5. It's TypeScript, and the whole thing is one architectural
> model: Ports and Adapters with DDD tactical patterns."

## 0:15–2:15 — The domain first

Open `src/domain/inbox/InboxItem.ts`.

> "This file is the whole business. It has zero imports from outside the domain — no Fastify, no
> `pg`, no `Date.now()` reached for implicitly. That's enforced, not just a convention — I'll show
> that in a minute.
>
> The lifecycle is pending → claimed → completed or cancelled. Look at `complete()` — this is the
> one method that matters. Five things happen in this order, and the order is deliberate:
>
> First — idempotent replay. If this exact idempotency key already completed this item, return
> silently, no error, no new event. That's what makes a double-click safe.
>
> Second — terminal-state guard. You can't touch a completed or cancelled item.
>
> Third — authorization. Only the current claimer, or the assignee if nobody's claimed it yet,
> can complete it.
>
> Fourth — the outcome policy. `upload_documentation` only accepts `done`. `approve_expense`
> accepts `approved` or `rejected`, but rejecting requires a note — that's enforced right here in
> the domain, not as a UI nicety.
>
> Fifth — only now does anything mutate. If the item was still pending, completing it auto-claims
> first, as one atomic act, so a double-click can never interleave someone else's claim in
> between.
>
> Every guard runs before the first assignment. A rejected completion leaves the aggregate
> byte-identical — I have a test for exactly that."

## 2:15–3:15 — The invariant tests

Run in the terminal:

```bash
npm test
```

> "Sixteen tests, domain and use-case level, no database, no HTTP, run in about a second and a
> half. These two are the ones I'd point to first —"

Open `test/unit/domain/InboxItem.spec.ts` and scroll to:
- `'is idempotent: replaying the same key changes nothing and emits nothing'`
- `'leaves the aggregate untouched when a completion is refused'`

> "— because they're not testing implementation, they're testing the two guarantees the whole
> design is built around: safe replay, and no partial mutation on a rejected transition."

## 3:15–5:30 — The double-click demo

Switch to the browser at `http://localhost:3000`.

> "This is the second driving adapter — a server-rendered UI over the exact same use cases as the
> JSON API. No JavaScript required for any of this to work."

Click into the expense item, select **Approve**, click **Submit decision** — narrate the redirect
and flash message.

> "That's a POST, then a 303 redirect, then a GET — so refreshing or hitting back never
> resubmits. Watch what happens if I try to act on it again —"

Navigate back to that item (it will show the recorded outcome; there's no form because
`availableActions` is now empty).

> "There's no form. The button that would let you double-submit doesn't exist once the domain
> says the item is done — the UI renders exactly what the aggregate permits, nothing is
> hardcoded."

Switch to the terminal for the same guarantee from the API side:

```bash
ID=$(curl -s localhost:3000/api/inbox-items | jq -r '.items[] | select(.status=="pending") | .id' | head -1)

# Same key, twice — identical response both times
for i in 1 2; do
  curl -s -X POST localhost:3000/api/inbox-items/$ID/completion \
    -H 'content-type: application/json' -H 'x-actor-id: ana.silva' \
    -H 'idempotency-key: demo-key-0001' -d '{"outcome":"done"}' | jq '{status, version, completion}'
done

# A DIFFERENT key on the same item — 409, not a silent second completion
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/inbox-items/$ID/completion \
  -H 'content-type: application/json' -H 'x-actor-id: ana.silva' \
  -H 'idempotency-key: demo-key-0002' -d '{"outcome":"done"}'
```

> "Identical body both times — same version, same timestamp, no duplicate event. A different key
> against the same completed item is a 409, with a message an operator can actually act on, not a
> stack trace."

## 5:30–7:15 — The hexagon claim, cashed

Put `src/api/http/routes/inboxItemRoutes.ts` and `src/api/web/routes/registerWebRoutes.ts`
side by side.

> "Here's the claim I want to actually prove, not just assert: two adapters, one domain, zero
> duplicated business logic. Every route in both files is the same shape — parse input, lift it
> into a value object, call one use case, send the result. There is nowhere in either file for a
> rule to hide.
>
> And the boundary between layers isn't a convention I'm asking you to trust —"

```bash
npm run lint
```

> "— `no-restricted-paths` fails the build if `src/domain` ever imports `src/application` or
> `src/infrastructure`. I actually verified this works, not just that it's configured: I
> temporarily added a domain-to-infrastructure import, confirmed lint caught it, then reverted
> it. That's in the commit history if you want to see the diff."

## 7:15–9:00 — What I'd do next, and why

> "Three things, in priority order. One: real authentication. `X-Actor-Id` is a header right now,
> confined to one function — `actorFrom()` — so swapping in a verified JWT subject is a one-place
> change, but until identity is real, authorization is a toy.
>
> Two: an outbox drainer. Every domain event is already written transactionally to an
> `outbox_event` table alongside the state change — so an approval is never recorded without its
> notification, or the reverse — but nothing reads that table yet. The atomicity guarantee is
> real; the delivery isn't, until there's a consumer.
>
> Three: priority-aware ordering. The inbox sorts by `created_at` right now, which is correct but
> not what an operator actually wants first — that needs a composite keyset over
> `(priority_rank, created_at, id)`, and I chose a correct simple order over an incorrect nice one
> under time pressure."

## 9:00–9:30 — What I'm proud of

> "The idempotency key lives in the domain, not in HTTP middleware or a database table. That one
> decision is why the UI adapter got double-submit safety for free — I didn't write a single line
> of idempotency handling in `src/api/web`. When a second, very different caller needed the same
> guarantee, it just had it. That's the payoff this architecture is actually for."

---

## Appendix: things to have ready before recording

- `npm run dev` running, `STORE=memory` (default) so the four seeded items are visible.
- A second pending item available for the API idempotency demo — restart the dev server if the
  earlier browser demo already completed the only one you want to reuse.
- `jq` installed, or drop the `| jq` pipes and read raw JSON.
