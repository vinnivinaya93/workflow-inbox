# Workflow Inbox — Staged Build (TypeScript · DDD · Ports & Adapters)

This folder is the design + code record for the prescreen exercise in
`Interview Prescreen Project.doc`.

- **Chosen prompt:** Option 5 — *Workflow Inbox* (internal operations tool: list pending
  actions such as *approve an expense*, *review a deployment*, *upload documentation*,
  *complete onboarding*; view and complete them).
- **Language:** TypeScript, as the doc requires.
- **Architecture:** one model, applied everywhere — **Ports & Adapters (Hexagonal)** with
  **DDD tactical patterns** (aggregate, value objects, domain events, repository ports).
  There is exactly one dependency rule and no stage breaks it.

## Why Workflow Inbox

Of the six prompts this is the only one with a genuine **domain**: an item has a lifecycle
(`pending → claimed → completed | cancelled`), rules about *who* may act, rules about *what
counts as a valid outcome per kind of work*, and a hard requirement that "complete this
action" be **idempotent** — an operator double-clicking *Approve*, or a retrying caller,
must not produce two approvals. That makes it worth modelling properly instead of writing a
CRUD table, and it is the part of the system a teammate would keep building on.

## Read in this order

| File | Stage | What it contains |
| --- | --- | --- |
| [01-architecture-single-model-ddd.md](01-architecture-single-model-ddd.md) | 0 | The single architectural model, dependency rule, ubiquitous language, one traced end-to-end flow, project scaffold |
| [02-stage-1-domain-model.md](02-stage-1-domain-model.md) | 1 | Pure domain: value objects, `InboxItem` aggregate, invariants, domain events, domain tests |
| [03-stage-2-application-layer.md](03-stage-2-application-layer.md) | 2 | Ports (repository, unit of work, clock, ids, events), use cases, view DTOs |
| [04-stage-3-infrastructure-adapters.md](04-stage-3-infrastructure-adapters.md) | 3 | Driven adapters: in-memory store, PostgreSQL repository + migrations, transactional outbox |
| [05-stage-4-http-api-adapter.md](05-stage-4-http-api-adapter.md) | 4 | Driving adapter: contract-first HTTP API, validation, problem+json errors, composition root |
| [06-stage-5-observability-and-tests.md](06-stage-5-observability-and-tests.md) | 5 | Request IDs, structured logs, metrics, use-case tests, Testcontainers integration tests |
| [07-stage-6-accessible-ui.md](07-stage-6-accessible-ui.md) | 6 | Second driving adapter: server-rendered accessible UI over the same use cases |
| [08-project-readme-and-tradeoffs.md](08-project-readme-and-tradeoffs.md) | — | The `README.md` to ship in the repo: run steps, assumptions, tradeoffs, next day |

Each stage file is self-contained: **why this stage exists → the files it adds → the code →
what it proves → how to verify it**. Stages only ever add adapters or move inward-to-outward;
no stage rewrites an earlier one.

## The 60-minute cut line

The doc asks for **no more than 60 minutes**. Taking that seriously, the full stage set here
is *not* claimed as an hour of work. The build is split explicitly:

| Stage | In the hour? | Budget |
| --- | --- | --- |
| 0 — scaffold | ✅ | 5 min |
| 1 — domain model + domain tests | ✅ | 15 min |
| 2 — ports + use cases | ✅ | 10 min |
| 3 — in-memory adapter only (Postgres/outbox deferred) | ⚠️ partial | 5 min |
| 4 — HTTP API + composition root | ✅ | 15 min |
| 5 — request IDs + pino logging only (metrics/Testcontainers deferred) | ⚠️ partial | 5 min |
| 6 — minimal server-rendered list + complete form | ✅ | 5 min |

Everything marked ⚠️ or absent above is written up here as **"what I would have done next"**,
which the doc explicitly invites. Stage 3's PostgreSQL adapter, Stage 5's metrics and
Testcontainers suites, and the outbox drainer are the honest post-hour continuation — they are
included because the interview is "the starting point for a technical conversation" about how
this evolves into a platform, and because the in-memory adapter was designed from the start to
be swapped without touching the domain.

## Requirements traced from the doc

| Doc asks for | Where it lands |
| --- | --- |
| Pick one project | Option 5, Workflow Inbox |
| TypeScript | All stages |
| Thoughtful user experience | Stage 6 (no-JS-first forms, flash + focus handling) |
| Clear API design | Stage 4 (resource-per-transition, `Idempotency-Key`, keyset pagination) |
| Accessibility | Stage 6 (semantic table, `aria-live`, focus target, visible focus, labels) |
| Maintainable code | Stages 1–2 (domain has zero framework imports) |
| Project organization | Stage 0 (one dependency rule, enforced by lint) |
| Error handling | Stage 1 (typed domain errors) + Stage 4 (RFC 9457 mapping) |
| Sensible validation | Stage 1 (value objects) + Stage 4 (zod at the edge) |
| Observability | Stage 5 (request IDs, structured logs, metrics, health probes) |
| Good documentation | This folder + Stage 8 README |
| Appropriate use of libraries | Stage 0 (5 runtime deps, rationale each) |
| Good engineering tradeoffs | Recorded per stage and summarised in Stage 8 |
| README (run, assumptions, tradeoffs, next day) | [08-project-readme-and-tradeoffs.md](08-project-readme-and-tradeoffs.md) |

Explicitly **not** built, per the doc's "You Don't Need to Impress Us": authentication,
CI/CD, Kubernetes, deployment scripts. The actor identity is taken from a header and that
choice is called out as an assumption rather than hidden.
