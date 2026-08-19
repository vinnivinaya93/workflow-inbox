# Requirements checklist

Every requirement from the take-home doc, mapped to where it is met in this repository — including
the things the doc says **not** to build (deliberately absent) and the **optional** deliverable
(done). Paths are clickable from the repo root.

## Core deliverables (required)

| Doc asks for | Status | Where |
| --- | --- | --- |
| Pick **one** of the six projects | ✅ | Option 5 — Workflow Inbox |
| **TypeScript** | ✅ | Entire `src/`, `test/`, `scripts/`; `strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` in `tsconfig.json` |
| Source code in a **Git repository** | ✅ | This repo; incremental commits, not one dump |
| A **README** | ✅ | [`README.md`](../README.md) |
| README: **how to run** | ✅ | README → "Run it" (`npm install && npm run dev`, zero infra) |
| README: **assumptions** | ✅ | README → "Assumptions" (6, numbered) |
| README: **tradeoffs** | ✅ | README → "Tradeoffs I chose on purpose" (13, with rationale) |
| README: **another day, what would you improve** | ✅ | README → "If I had another day" (8, prioritised, time-estimated) |

## Option 5 functional requirements

| Doc asks for | Status | Where |
| --- | --- | --- |
| Display a **list** of pending actions | ✅ | UI [`inboxListPage.ts`](../src/api/web/views/inboxListPage.ts); API `GET /api/inbox-items` in [`inboxItemRoutes.ts`](../src/api/http/routes/inboxItemRoutes.ts) |
| The example action types (approve expense, review deployment, upload docs, complete onboarding) | ✅ | [`ItemKind.ts`](../src/domain/inbox/value-objects/ItemKind.ts) — all four, each with its outcome policy |
| **View** an action | ✅ | UI `GET /items/:id` ([`itemDetailPage.ts`](../src/api/web/views/itemDetailPage.ts)); API `GET /api/inbox-items/:id` |
| **Complete** an action | ✅ | UI decision form → `POST /items/:id/complete`; API `POST /api/inbox-items/:id/completion` (idempotent) |

## "Things we enjoy seeing" (not all required; each addressed)

| Item | Status | Where |
| --- | --- | --- |
| Thoughtful user experience | ✅ | Server-rendered, works with JS off; post/redirect/get so refresh never re-submits; flash messages; `cache-control: no-store`; the decision form offers only the outcomes the domain allows |
| Clear API design | ✅ | Transitions as sub-resources (`/claim`, `/release`, `/completion`, `/cancellation`); `Idempotency-Key` required on completion; keyset pagination; `Location` on create; contract-first OpenAPI ([`contracts/openapi.yaml`](../contracts/openapi.yaml)) generated from the zod schemas |
| Accessibility | ✅ | Skip link, `role=status`/`aria-live` flash, `<main tabindex=-1>` focus target, semantic table (`<caption>`, `<th scope>`), labelled inputs, visible focus, not colour-alone, `<time datetime>`, `.visually-hidden` link text. Full table in README → "Accessibility checklist" |
| Maintainable code | ✅ | Hexagonal + DDD; `src/domain/**` has zero framework imports; one method (`InboxItem.complete`) holds the whole completion rule |
| Project organization | ✅ | One dependency rule (`domain ← application ← {api, infrastructure}`) **enforced** by `import/no-restricted-paths` in [`.eslintrc.cjs`](../.eslintrc.cjs) — verified by deliberately injecting a forbidden import and watching `npm run lint` fail (git history) |
| Error handling | ✅ | Typed domain errors ([`errors.ts`](../src/domain/inbox/errors.ts)) mapped once to RFC 9457 `application/problem+json` ([`problemDetails.ts`](../src/api/http/problemDetails.ts)); 500s leak nothing, correlated by `requestId` |
| Sensible validation | ✅ | Two layers with different jobs: zod at the transport edge ([`inboxItemContracts.ts`](../src/api/http/contracts/inboxItemContracts.ts)) + total value-object factories in the domain |
| Observability | ✅ | Request IDs (inbound `x-request-id` honoured, echoed on the response and in every error body); structured pino logs with actor redaction; Prometheus `/metrics` — HTTP duration + business counters, populated in **both** runtimes; `/healthz` liveness + `/readyz` readiness |
| Good documentation | ✅ | This checklist, [`README.md`](../README.md), [`docs/design/`](design/00-design-index.md) (design record), [`docs/runbook.md`](runbook.md), [`docs/demo-script.md`](demo-script.md) |
| Appropriate use of libraries | ✅ | 6 runtime deps (fastify, zod, pino, pg, prom-client, @fastify/formbody), each justified in `docs/design/01-…`; no ORM, no DI framework |
| Good engineering tradeoffs | ✅ | 13 in README, recorded with the rejected alternative and the reason |

## Things the doc says you **don't need to add** (deliberately absent)

| Item | Status | Note |
| --- | --- | --- |
| Authentication | ✅ **not built** | Actor comes from `X-Actor-Id`, confined to `actorFrom()` in [`requestContext.ts`](../src/api/http/requestContext.ts); called out as Assumption 1. Swapping in a verified JWT subject is a one-function change. |
| CI/CD | ✅ **not built** | No pipeline files. |
| Kubernetes | ✅ **not built** | No manifests/helm. |
| Deployment scripts | ✅ **not built** | None. |
| Docker | ⚠️ **one compose file, justified** | `docker-compose.yml` exists *only* to run the optional PostgreSQL mode and its Testcontainers-independent manual runs. Nothing on the default path uses it; the default runtime is in-memory. Kept because it's the standard way to stand up the one dependency the optional mode needs — not to impress. |

## Optional deliverable

| Doc asks for | Status | Where |
| --- | --- | --- |
| Screen recording (5–10 min): what you built, why, what you'd change, what you're proud of | ◐ **script provided** | [`docs/demo-script.md`](demo-script.md) — a full, timed 9-minute narration script, every command and click path in it verified against the running app. The video itself is not included (no recording capability in the build environment); the script is ready to read straight into one. |

## Verification (how to confirm the above yourself)

```bash
npm install
npm run typecheck     # strict TS, clean
npm run lint          # clean; also proves the architecture boundary is enforced
npm test              # 21 domain + use-case unit tests, no I/O
npm run openapi:check # the committed OpenAPI matches the zod schemas
npm run dev           # then click the UI, or curl the API (see README → 30-second demo)
npm run test:all      # + HTTP integration and PostgreSQL Testcontainers suites (needs Docker)
```
