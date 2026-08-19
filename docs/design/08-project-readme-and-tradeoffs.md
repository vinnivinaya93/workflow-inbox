# The Project README (to ship in the repo)

Everything below is the content of `README.md` at the repository root — the deliverable the doc
asks for: *how to run it, assumptions, tradeoffs, and what another day would buy.*

---

# Workflow Inbox

An internal operations inbox: the pending actions a person owes the business — approve an
expense, review a deployment, upload documentation, complete onboarding — with a JSON API and a
server-rendered UI for viewing and completing them.

Built for the technical discussion exercise, Option 5. **TypeScript, ~60 minutes of build time**,
with the parts I did not reach called out honestly at the bottom.

## Run it

Needs Node 20+. No database, no Docker, nothing else.

```bash
npm install
npm run dev
# → http://localhost:3000        the operator UI, seeded with four items
# → http://localhost:3000/api/inbox-items
```

```bash
npm test              # domain + use-case unit tests (fast, no I/O)
npm run test:all      # adds HTTP integration and PostgreSQL Testcontainers suites (needs Docker)
npm run typecheck
npm run lint          # also enforces the architectural import boundaries
```

Optional PostgreSQL mode:

```bash
docker compose up -d postgres
export DATABASE_URL=postgres://inbox:inbox@localhost:5432/inbox STORE=postgres
npm run migrate && npm run dev
```

### The 30-second demo

```bash
ID=$(curl -s localhost:3000/api/inbox-items | jq -r '.items[0].id')

# Approve it, twice, with the same Idempotency-Key → one approval, identical response
for i in 1 2; do
  curl -s -X POST localhost:3000/api/inbox-items/$ID/completion \
    -H 'content-type: application/json' -H 'x-actor-id: ana.silva' \
    -H 'idempotency-key: demo-key-0001' -d '{"outcome":"approved"}' \
    | jq '{status, version, completion}'
done

# A different key on the same item → 409, not a silent second approval
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/inbox-items/$ID/completion \
  -H 'content-type: application/json' -H 'x-actor-id: ana.silva' \
  -H 'idempotency-key: demo-key-0002' -d '{"outcome":"approved"}'
```

## What is where

```
src/domain/        the rules. zero dependencies, zero framework imports
src/application/   use cases + the five ports they need
src/infrastructure/ adapters: in-memory, PostgreSQL, clock, ids, logging, metrics
src/api/http/      JSON API adapter
src/api/web/       server-rendered UI adapter — same use cases, no duplicated logic
src/composition/   the only file that knows which implementation is which
```

Ports & adapters with DDD tactical patterns, and one dependency rule: **nothing inside imports
anything outside**. That rule is enforced by `eslint-plugin-import`'s `no-restricted-paths`, so it
cannot rot quietly.

The interesting file is [`src/domain/inbox/InboxItem.ts`](src/domain/inbox/InboxItem.ts). Read it
and you know the whole business: the lifecycle, who may act, which outcomes each kind of work
accepts, and why completing an item twice is safe.

## Assumptions

1. **There is no authentication.** The actor comes from an `X-Actor-Id` header (the UI defaults to
   `ana.silva`). Everything downstream treats it as a trusted identity, and it is confined to one
   function — `actorFrom()` in `src/api/http/requestContext.ts` — so swapping in a verified JWT
   subject is a change in one place. The doc said not to add auth to impress anyone; I took that
   at face value rather than half-building it.
2. **Items are created by upstream systems, not by operators.** `POST /api/inbox-items` exists so
   the exercise is demonstrable; in reality the expense service would create the item. That is why
   there is no "new item" screen in the UI.
3. **The inbox owns the decision, not the subject.** It stores `kind` + `title`, never expense
   amounts or deployment metadata. Upstream contexts keep their own data and learn the outcome
   from the `inbox.item.completed` event.
4. **`ActorId` is an internal handle** (`ana.silva`), not an email, so logs and events carry no
   contact data. `X-Actor-Id` is redacted from logs for the same reason.
5. **One person acts on an item.** No delegation, no multi-approver quorum, no escalation. Those
   are real requirements in this domain and each would change the aggregate; inventing them here
   would have been speculative.
6. **Single-region, single-writer PostgreSQL.** Optimistic concurrency assumes a linearisable
   store.

## Tradeoffs I chose on purpose

| # | Chose | Instead of | Why |
| --- | --- | --- | --- |
| 1 | Hexagonal + DDD for a small app | A single `routes.ts` + a service class | The value here is *rules*, and this puts them somewhere testable in microseconds. It is more structure than 60 minutes of features needs — the bet is on the second month, not the first hour. |
| 2 | Idempotency enforced in the **domain** | An idempotency table in the HTTP layer | "An item is completed at most once" is a business rule. In the domain, no adapter can bypass it — which the UI adapter promptly proved by getting it for free. |
| 3 | Optimistic concurrency (`version`) | `SELECT … FOR UPDATE` | Human-paced contention is rare; a 409 saying "this changed under you" is cheaper and more honest than holding locks across a think-time. |
| 4 | Two version fields (`version`, `persistedVersion`) | One | So the response tells the client the version that is actually stored. With one field a caller reads back a stale number and its next conditional request fails for no reason. |
| 5 | Raw `pg` + a hand-written mapper | Prisma / TypeORM | Keeps the aggregate from being shaped by the schema. The mapper is ~60 boring lines and is the only file that knows both shapes. |
| 6 | Keyset pagination | `LIMIT`/`OFFSET` | An inbox receives items constantly; offsets skip and duplicate rows mid-pagination. Cost: no jump-to-page, and sorting is fixed to `created_at DESC`. |
| 7 | `created_at DESC` ordering, not priority | Priority-first ordering | Priority ordering needs a composite keyset over `(priority_rank, created_at, id)`. It is the better UX and the first thing I would add — I chose a correct simple order over an incorrect nice one. |
| 8 | Server-rendered HTML | React SPA | Accessibility, keyboard support and back/forward come free; no build step; and it demonstrates the second-adapter claim. Cost: no optimistic UI, a full round-trip per action. |
| 9 | Seven near-duplicate use-case classes | A generic `TransitionUseCase` base | Saves ~8 lines, costs per-transition command types and the natural home for per-transition authorisation later. Duplication is cheaper than the wrong abstraction at this size. |
| 10 | Reads go through the unit of work | A separate read path | One way to reach storage. It costs a `BEGIN`/`COMMIT` on reads and buys a clean seam for a real read model when list queries outgrow the write schema. |
| 11 | Hand-rolled 30-line migration runner | A migration framework | One dependency avoided for one table. I would replace it before the *second* migration — down-migrations, advisory locks and concurrent deploys are where hand-rolled runners bite. |
| 12 | `CHECK` constraints mirroring invariants | Trusting the application | The database refuses to hold a shape the aggregate cannot produce, which is the only defence against a hand-written `UPDATE` at 3am. |
| 13 | In-memory adapter as the **default** runtime | Postgres-only | `npm install && npm run dev` works with zero setup, so reviewing costs nothing. The integration suite keeps the two adapters honest with each other. |

## Known gaps

Named rather than hidden, because I would rather be asked about a gap I flagged:

- **No auth/authorisation.** Assumption 1.
- **No `.visually-hidden` CSS class**, though the list view uses it — a real accessibility pass
  (axe in CI + one screen-reader run) would have caught it. My checklist is a plan, not evidence.
- **Templates escape by convention**, not by construction. A tagged-template literal that escapes
  by default would remove the human from the loop; the `esc()` discipline currently relies on
  review.
- **The outbox has no drainer.** Events are written transactionally and correctly, and nothing
  reads them yet. The design sketch (`FOR UPDATE SKIP LOCKED`) is in the docs.
- **`ConcurrencyConflict` conflates "gone" and "someone wrote first."** Both mean "re-read", so I
  did not spend a second query distinguishing them.
- **Metrics and the Testcontainers suites are past the hour mark.** They are in the repo; they are
  not part of the 60-minute claim.
- **Rate limiting, pagination on the UI's filter combinations, and bulk actions** are absent.

## If I had another day

In priority order — each is a decision I can defend, not a wish list:

1. **Real authentication and per-item authorisation** (~2h). Replace `X-Actor-Id` with a verified
   JWT subject in `actorFrom()`, then add a policy port so "who may act on this item" can consider
   role and delegation instead of just assignee equality. Everything else is guesswork until
   identity is real.
2. **Priority-aware ordering with a composite keyset** (~1h). `(priority_rank, created_at, id)`
   plus a matching index, so the top of the inbox is what an operator actually needs to see first.
   Tradeoff 7, repaid.
3. **The outbox drainer plus one real consumer** (~2h). `FOR UPDATE SKIP LOCKED`, an at-least-once
   contract, and a consumer that closes the loop back to the expense service. Until something
   reads the outbox, the atomicity guarantee is theoretical.
4. **Escaping by construction** (~30m). An `html` tagged template that escapes interpolations by
   default with an explicit `raw()` opt-out, then delete the `esc()` calls. Removes a whole class
   of future bug rather than fixing an instance of it.
5. **Accessibility evidence** (~1h). `axe-core` in CI over both pages, one NVDA pass, add the
   missing utility class. Turn the checklist into a test.
6. **Tracing, not just metrics** (~1.5h). OpenTelemetry spans around the use case and each SQL
   statement, with `requestId` as a span attribute. The current logs answer "what happened"; a
   trace answers "where did the 800ms go".
7. **A read model for the list view** (~2h). The write schema is already the wrong shape for
   filtered, sorted, counted queries. Tradeoff 10 left the seam for this deliberately.
8. **Item expiry / SLA breach** (~2h). `dueAt` is stored and displayed but nothing acts on it. A
   scheduled sweep emitting `inbox.item.overdue` is the natural next domain event, and it forces
   the first interesting design question in this model: does the aggregate expire itself, or does
   a policy do it?

## If this became part of a larger platform

The question the doc says will start the conversation, answered in three moves:

- **The aggregate is already the durable unit.** An inbox item is a small, long-lived, resumable
  state machine keyed by a stable id, with idempotent transitions and events on every change.
  That is exactly the shape a durable-execution engine wants, so putting the *orchestration* of a
  multi-step approval into one would not require re-modelling the domain — the state machine is
  the part that usually needs rewriting, and it is already isolated and free of I/O.
- **The events are the integration contract, not the tables.** `inbox.item.completed` carries the
  minimum a consumer needs and is already delivered at-least-once with an idempotency key in the
  payload. Adding the second, third and tenth upstream context is a subscription each, not a
  schema negotiation.
- **The seams that would take the strain are already ports.** A different store, a queue instead
  of an outbox table, a policy service for authorisation, a read model for the list view — each is
  an adapter behind an interface the domain already depends on, so scaling the platform means
  writing adapters rather than re-opening `InboxItem.ts`.

## Screen recording outline (5–10 min)

1. **The domain first** (2 min) — `InboxItem.ts` top to bottom. The lifecycle, the four guards in
   `complete()`, and why every guard runs before the first assignment.
2. **The invariant tests** (1 min) — `npm test`, then the idempotency and no-partial-mutation
   cases specifically.
3. **The double-click demo** (2 min) — the UI: approve twice fast, one approval. Then the same via
   curl with a second key: a 409 with a message an operator can act on.
4. **The hexagon claim, cashed** (2 min) — the JSON API and the HTML UI side by side in the editor:
   two adapters, zero shared logic duplicated, one domain.
5. **What I would do next and why** (2 min) — tradeoffs 7 and 2, then the "another day" list.
