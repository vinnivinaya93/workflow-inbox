# Runbook

Quick reference for on-call triage. Correlate everything by `requestId` (log field, response
header `x-request-id`, and the `requestId` field in every `application/problem+json` body).

| Symptom | First look | Likely cause | Action |
| --- | --- | --- | --- |
| `inbox_conflicts_total{code="http_409"}` climbing | Logs filtered to `ITEM_COMPLETION_CONFLICT` | A client retrying with a fresh key per attempt | Client bug: the key must be minted per *intent*, not per request |
| `/readyz` failing, `/healthz` fine | `SELECT 1` latency, pool saturation | Database or connectivity | Do not restart the app; it is deliberately not self-inflicted |
| `outbox_events_enqueued_total` rising, consumers quiet | `SELECT count(*) FROM outbox_event WHERE published_at IS NULL` | Drainer stopped (note: no drainer is built yet — see README known gaps) | Restart the drainer; delivery is at-least-once, so replays are safe |
| Operator: "my approval vanished" | `SELECT * FROM outbox_event WHERE aggregate_id = …` then the item row | Almost always a 409 the UI surfaced badly | Read `completion.by`/`at`; the audit record is authoritative |
| p99 latency up, DB fine | `http_server_request_duration_seconds` by `route` | Unbounded page size or a missing index | Check `limit`; `EXPLAIN` the list query against `inbox_item_page_idx` |

## Useful queries

```sql
-- Items stuck claimed for a long time
SELECT id, title, claimed_by, claimed_at
FROM inbox_item
WHERE status = 'claimed' AND claimed_at < now() - interval '1 day';

-- Outbox backlog
SELECT count(*) FROM outbox_event WHERE published_at IS NULL;
```

## Endpoints

- `GET /healthz` — liveness, never touches dependencies.
- `GET /readyz` — readiness, runs `SELECT 1` against the pool when `STORE=postgres`.
- `GET /metrics` — Prometheus exposition format.
