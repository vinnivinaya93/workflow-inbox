CREATE TABLE IF NOT EXISTS inbox_item (
  id                UUID        PRIMARY KEY,
  kind              TEXT        NOT NULL
                      CHECK (kind IN ('approve_expense','review_deployment',
                                      'upload_documentation','complete_onboarding')),
  title             TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
  assignee          TEXT        NOT NULL,
  priority          TEXT        NOT NULL CHECK (priority IN ('low','normal','high','urgent')),
  due_at            TIMESTAMPTZ,
  status            TEXT        NOT NULL
                      CHECK (status IN ('pending','claimed','completed','cancelled')),
  claimed_by        TEXT,
  claimed_at        TIMESTAMPTZ,
  outcome           TEXT        CHECK (outcome IN ('approved','rejected','done')),
  completion_note   TEXT,
  completed_by      TEXT,
  completed_at      TIMESTAMPTZ,
  idempotency_key   TEXT,
  cancel_reason     TEXT,
  cancelled_by      TEXT,
  cancelled_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL,
  version           INTEGER     NOT NULL DEFAULT 0,

  -- The database refuses to hold a shape the aggregate cannot produce.
  CONSTRAINT completed_items_are_complete CHECK (
    (status <> 'completed')
    OR (outcome IS NOT NULL AND completed_by IS NOT NULL
        AND completed_at IS NOT NULL AND idempotency_key IS NOT NULL)
  ),
  CONSTRAINT claimed_items_have_a_claimer CHECK (
    (status <> 'claimed') OR (claimed_by IS NOT NULL AND claimed_at IS NOT NULL)
  ),
  CONSTRAINT cancelled_items_have_a_reason CHECK (
    (status <> 'cancelled') OR (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL)
  )
);

-- Serves the keyset page order, and the inbox's dominant query ("my open work").
CREATE INDEX IF NOT EXISTS inbox_item_page_idx    ON inbox_item (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS inbox_item_open_idx    ON inbox_item (assignee, created_at DESC)
  WHERE status IN ('pending','claimed');

CREATE TABLE IF NOT EXISTS outbox_event (
  id            BIGSERIAL   PRIMARY KEY,
  aggregate_id  UUID        NOT NULL,
  name          TEXT        NOT NULL,
  payload       JSONB       NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  published_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON outbox_event (id)
  WHERE published_at IS NULL;
