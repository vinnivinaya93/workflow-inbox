# Stage 0 — The Architectural Model (and the scaffold)

> One model, applied to every file in every stage: **Ports & Adapters (Hexagonal)** on the
> outside, **DDD tactical patterns** on the inside. Read this once and every later stage is
> predictable.

## 1. The one dependency rule

```
Nothing inside may import anything outside.
domain ← application ← { api, infrastructure } ← composition
```

Concretely, `src/domain/**` imports **only** `src/domain/**` and the TypeScript standard
library. No Fastify, no `pg`, no zod, no `Date.now()` reached for implicitly, no logger. If
that rule ever needs bending, the model is wrong, not the rule.

```
                     ┌──────────────── driving adapters (inbound) ─────────────────┐
                     │   src/api/http  (JSON API)      src/api/web  (server HTML)  │
                     └───────────────────────────┬────────────────────────────────-─┘
                                                 │  calls use cases only
                     ┌───────────────────────────▼────────────────────────────────┐
                     │  src/application    use cases + PORTS (interfaces)         │
                     │  CreateInboxItem · ListInboxItems · ClaimInboxItem ·       │
                     │  CompleteInboxItem · ReleaseInboxItem · CancelInboxItem    │
                     └───────────────────────────┬────────────────────────────────┘
                                                 │  orchestrates
                     ┌───────────────────────────▼────────────────────────────────┐
                     │  src/domain         THE HEXAGON'S CORE                     │
                     │  InboxItem aggregate · value objects · domain events ·      │
                     │  domain errors · kind policy                               │
                     │  ZERO dependencies                                          │
                     └───────────────────────────▲────────────────────────────────┘
                                                 │  implements ports
                     ┌───────────────────────────┴────────────────────────────────┐
                     │  src/infrastructure   driven adapters (outbound)            │
                     │  InMemory* · Pg* + migrations · Outbox · SystemClock ·      │
                     │  UuidGenerator · pino logger · prom-client metrics          │
                     └────────────────────────────────────────────────────────────┘
                          src/composition/container.ts wires all of the above
```

**Why this model and not layered-MVC or a service-per-controller?** The interesting risk in
this system is *rules*, not *transport*: who may complete an item, what outcomes a kind of
work accepts, and what happens when the same completion arrives twice. Hexagonal keeps those
rules in a place that is unit-testable in microseconds with no database and no HTTP, and it
makes the "swap in-memory for Postgres" step in Stage 3 a wiring change rather than a rewrite.
The second payoff shows up in Stage 6: the HTML UI is a *second* driving adapter over the same
use cases, with no duplicated business logic.

### Enforcing it rather than trusting it

`.eslintrc.cjs` (Stage 0) makes the rule a build error, so a future teammate cannot regress it
by accident:

```js
// .eslintrc.cjs
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { project: './tsconfig.json' },
  plugins: ['@typescript-eslint', 'import'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    'import/no-restricted-paths': ['error', {
      zones: [
        { target: './src/domain', from: './src/application', message: 'domain must not import application' },
        { target: './src/domain', from: './src/infrastructure', message: 'domain must stay dependency-free' },
        { target: './src/domain', from: './src/api', message: 'domain must stay dependency-free' },
        { target: './src/application', from: './src/infrastructure', message: 'application depends on ports, not adapters' },
        { target: './src/application', from: './src/api', message: 'application must not know its callers' },
      ],
    }],
  },
};
```

## 2. Bounded context and ubiquitous language

**Context:** *Workflow Inbox* — the human-decision surface of an internal operations platform.
It owns "a person owes the business a decision or an action". It does **not** own expenses,
deployments, or onboarding; those are upstream contexts that *ask* for a decision and later
read the outcome. That boundary is why an item carries `kind` + `payload`-free fields instead
of expense amounts: the inbox must not grow a copy of every upstream schema.

| Term | Meaning in code |
| --- | --- |
| **Inbox item** | The aggregate root. One unit of human work. |
| **Actor** | A person acting on items (`ActorId`, e.g. `ana.silva`). |
| **Assignee** | The actor the item is addressed to. |
| **Kind** | The type of work: `approve_expense`, `review_deployment`, `upload_documentation`, `complete_onboarding`. |
| **Claim** | An actor takes exclusive working ownership of a pending item. |
| **Release** | The claimer hands it back to `pending`. |
| **Outcome** | The terminal answer: `approved`, `rejected` (decision kinds) or `done` (task kinds). |
| **Completion** | The recorded terminal act: outcome + note + who + when + idempotency key. |
| **Kind policy** | The rule table mapping a kind to the outcomes it accepts. |

## 3. Aggregate boundary and invariants

One aggregate, `InboxItem`. It is the transaction and consistency boundary — every write in
this system loads exactly one item, mutates it, and saves it.

**Lifecycle**

```
                  claim(actor)                complete(actor, outcome, key)
   ┌─────────┐ ───────────────► ┌─────────┐ ─────────────────────────────► ┌───────────┐
   │ pending │ ◄─────────────── │ claimed │                                │ completed │
   └────┬────┘  release(actor)  └────┬────┘                                └───────────┘
        │                            │            complete(assignee, …) auto-claims first
        │  cancel(actor, reason)     │  cancel(actor, reason)
        └────────────┬───────────────┘
                     ▼
               ┌───────────┐
               │ cancelled │   (terminal)
               └───────────┘
```

**Invariants the aggregate enforces (Stage 1 encodes each as a test):**

1. A completed or cancelled item never changes again.
2. Only the current claimer may complete a claimed item; only the assignee may claim it.
3. `complete` on a `pending` item by its assignee auto-claims, then completes — one atomic act,
   because forcing the UI to make two calls would leave a window where a double-click races.
4. The outcome must be legal for the kind (`upload_documentation` cannot be `rejected`).
5. **Completion is idempotent by `IdempotencyKey`.** Replaying the same key on an already
   completed item is a success with no new event; a *different* key on a completed item is a
   `CompletionConflict`. This is the single most important rule in the model.
6. Claiming an item you already claimed is a no-op success (same reasoning as 5).
7. Every state change emits exactly one domain event and stamps `updatedAt`.
8. Writes are guarded by optimistic concurrency on `version`.

**Deliberately *not* invariants:** cross-item rules ("an actor may hold at most 5 claims") are
left out. They would need a second aggregate or a read-model check, and inventing distributed
invariants for a 60-minute exercise is exactly the wrong tradeoff.

## 4. The single flow, traced end to end

`POST /api/inbox-items/{id}/completion` with `Idempotency-Key: 9f2c…`. Every stage adds one
box to this same picture; the flow never changes shape.

```
1. api/http/routes/inboxItemRoutes.ts
     zod parses body/params/headers  ──►  CompleteInboxItemCommand   (transport → application)
     actor comes from X-Actor-Id     ──►  (Stage 8 assumption: stands in for real auth)

2. application/use-cases/CompleteInboxItem.ts
     uow.transaction(async ctx => {                     ← one transaction per use case
        item = await ctx.inboxItems.findById(id)        ← port, not SQL
        if (!item) throw new ItemNotFound(id)
        item.complete({ actor, outcome, note, idempotencyKey }, clock.now())   ← ALL rules here
        await ctx.inboxItems.update(item)               ← optimistic on version
        await ctx.events.publish(item.pullEvents())     ← same tx ⇒ atomic with the state change
        return toView(item)
     })

3. domain/inbox/InboxItem.ts
     - terminal-state guard          → ItemStateConflict
     - authorisation guard           → NotAssignedToActor
     - kind/outcome policy           → OutcomeNotAllowed
     - idempotency check             → replay: return silently, no event
                                     → different key: CompletionConflict
     - records InboxItemCompleted

4. infrastructure/persistence/pg/PgInboxItemRepository.ts
     UPDATE inbox_item SET … , version = version + 1 WHERE id = $1 AND version = $2
     0 rows ⇒ ConcurrencyConflict (port-level error, mapped to 409)

5. infrastructure/persistence/pg/OutboxEventPublisher.ts
     INSERT INTO outbox_event … (drained separately; upstream contexts learn the outcome)

6. api/http/problemDetails.ts
     domain/application error → RFC 9457 problem+json + requestId
     ItemStateConflict → 409 · NotAssignedToActor → 403 · OutcomeNotAllowed → 422
     CompletionConflict → 409 · ItemNotFound → 404 · ValidationError → 400
```

The four guard clauses in step 3 are the whole point of the architecture: they are reachable in
a test that constructs an aggregate in memory and calls one method.

## 5. Scaffold

### Runtime dependencies — five, each justified

| Dependency | Why it, why not something else |
| --- | --- |
| `fastify` | Fast, first-class TS types, `app.inject()` gives real HTTP tests with no port binding. Express would need extra typings and has weaker async error handling. |
| `zod` | Validation *and* the source of the OpenAPI contract, so the spec cannot drift from the parser. |
| `pino` | Structured JSON logs with near-zero overhead; Fastify ships with it. |
| `pg` | Plain driver + hand-written mapper keeps the domain persistence-ignorant and the SQL reviewable. An ORM would tempt entities to become tables. |
| `prom-client` | Standard metric exposition; no vendor lock. |

Dev-only: `typescript`, `tsx`, `vitest`, `@testcontainers/postgresql`, `eslint` + plugins.

### `package.json`

```json
{
  "name": "workflow-inbox",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "lint": "eslint \"src/**/*.ts\" \"test/**/*.ts\"",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --dir test/unit",
    "test:integration": "vitest run --dir test/integration",
    "test:all": "vitest run",
    "migrate": "tsx scripts/migrate.ts",
    "openapi": "tsx scripts/emit-openapi.ts",
    "openapi:check": "tsx scripts/emit-openapi.ts --check"
  },
  "dependencies": {
    "fastify": "^5.2.0",
    "pg": "^8.13.1",
    "pino": "^9.5.0",
    "prom-client": "^15.1.3",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^10.16.0",
    "@types/node": "^22.10.0",
    "@types/pg": "^8.11.10",
    "@typescript-eslint/eslint-plugin": "^8.18.0",
    "@typescript-eslint/parser": "^8.18.0",
    "eslint": "^8.57.1",
    "eslint-plugin-import": "^2.31.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

### `tsconfig.json`

Strict, and strict in the ways that actually catch domain bugs:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "declaration": false,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts"]
}
```

`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on deliberately — they are the
two flags that stop "undefined leaked into the aggregate" bugs, which is precisely the class of
bug that costs the most in a state machine.

### Folder skeleton (final shape, filled in stage by stage)

```
workflow-inbox/
├─ contracts/openapi.yaml               # generated, committed, CI-checked (Stage 4)
├─ migrations/001_init.sql              # Stage 3
├─ scripts/{migrate.ts,emit-openapi.ts} # Stage 3 / 4
├─ src/
│  ├─ domain/
│  │  ├─ shared/{brand.ts,AggregateRoot.ts,DomainEvent.ts,errors.ts}
│  │  └─ inbox/
│  │     ├─ value-objects/{InboxItemId,ActorId,Title,ItemKind,ItemStatus,Priority,Outcome,IdempotencyKey,CompletionNote}.ts
│  │     ├─ events.ts
│  │     ├─ errors.ts
│  │     └─ InboxItem.ts
│  ├─ application/
│  │  ├─ ports/{InboxItemRepository,UnitOfWork,Clock,IdGenerator,EventPublisher}.ts
│  │  ├─ views/InboxItemView.ts
│  │  ├─ errors.ts
│  │  └─ use-cases/{CreateInboxItem,ListInboxItems,GetInboxItem,ClaimInboxItem,ReleaseInboxItem,CompleteInboxItem,CancelInboxItem}.ts
│  ├─ infrastructure/
│  │  ├─ time/SystemClock.ts
│  │  ├─ id/UuidGenerator.ts
│  │  ├─ persistence/memory/{InMemoryInboxItemRepository,InMemoryUnitOfWork,RecordingEventPublisher}.ts
│  │  ├─ persistence/pg/{PgUnitOfWork,PgInboxItemRepository,inboxItemMapper,OutboxEventPublisher,cursor}.ts
│  │  └─ observability/{logger.ts,metrics.ts,MeteredEventPublisher.ts}
│  ├─ api/
│  │  ├─ http/{contracts/,routes/,problemDetails.ts,requestContext.ts,buildHttpApp.ts}
│  │  └─ web/{views/,routes/,escape.ts}
│  ├─ composition/container.ts
│  ├─ config.ts
│  └─ main.ts
└─ test/
   ├─ unit/{domain/,application/}
   └─ integration/{pg/,http/}
```

### `src/config.ts`

Config is read **once**, at the edge, and passed inward as plain values — never `process.env`
inside a use case.

```ts
// src/config.ts
export type StoreKind = 'memory' | 'postgres';

export interface AppConfig {
  readonly port: number;
  readonly logLevel: string;
  readonly store: StoreKind;
  readonly databaseUrl: string | null;
  readonly seedDemoData: boolean;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const store: StoreKind = env.STORE === 'postgres' ? 'postgres' : 'memory';
  return {
    port: Number(env.PORT ?? 3000),
    logLevel: env.LOG_LEVEL ?? 'info',
    store,
    databaseUrl: store === 'postgres' ? required('DATABASE_URL', env.DATABASE_URL) : null,
    seedDemoData: env.SEED_DEMO_DATA !== 'false' && store === 'memory',
  };
}
```

Default `STORE=memory` so `npm run dev` works with zero infrastructure — a reviewer can clone
and run in one command. Postgres is opt-in.

### `docker-compose.yml` (optional, Postgres only)

The doc says not to add Docker to impress anyone, so this exists purely so the Stage 3 adapter
and Stage 5 integration tests are runnable, and it is not on the default path.

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: inbox
      POSTGRES_USER: inbox
      POSTGRES_DB: inbox
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U inbox"]
      interval: 2s
      timeout: 3s
      retries: 20
```

## 6. Decisions recorded up front

| # | Decision | Alternative rejected | Because |
| --- | --- | --- | --- |
| 1 | Hexagonal + DDD tactical patterns | Controller→service→repo layering | The value is in the rules; this keeps them isolated and testable and lets the UI reuse them verbatim. |
| 2 | One aggregate = one transaction | Batch endpoints mutating many items | Keeps concurrency reasoning trivial; batch can be added later as N transactions with per-item results. |
| 3 | Idempotency key on completion, enforced *in the domain* | Idempotency table in the HTTP layer | The rule is a business rule ("one completion per item"), so it belongs where it can never be bypassed by a second adapter. |
| 4 | Optimistic concurrency via `version` | Pessimistic `SELECT … FOR UPDATE` | Human-paced contention is rare; a 409 telling the operator "this changed under you" is honest and cheap. |
| 5 | Transitions as sub-resources (`/claim`, `/completion`) | `PATCH { status }` | Encodes *which* transition is legal in the URL, allows per-transition payloads, and keeps `Idempotency-Key` scoped to the act it protects. |
| 6 | Raw `pg` + explicit mapper | Prisma / TypeORM | Prevents the aggregate from being shaped by the schema; the mapper is the only place that knows both. |
| 7 | Keyset (cursor) pagination | `OFFSET`/`LIMIT` | Stable under concurrent inserts, which an inbox has constantly. |
| 8 | Server-rendered UI, JS optional | SPA + client state | Accessibility and correctness for free; the exercise is about judgment, not a framework. |

Next: [Stage 1 — the domain model](02-stage-1-domain-model.md).
