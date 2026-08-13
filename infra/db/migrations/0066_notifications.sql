-- 0066_notifications.sql
-- In-app notifications: "sesuatu perlu Anda lakukan" (ACTION_REQUIRED, role-addressed,
-- resolved when the underlying item leaves its pending state) and one-way outcome
-- notices to the original actor (INFO, e.g. "transfer kamu di-reject").
--
-- One row per recipient (write-time fan-out for role broadcasts) — no separate
-- read-tracking join table. A new role-holder added after an item went pending
-- will not see the historical backlog via notifications; the existing worklist
-- screens (transfers/applications/data-reviews list, etc.) remain the source of
-- truth, this table is a convenience layer on top of them.

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  recipient_user_id BIGINT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('ACTION_REQUIRED', 'INFO')),
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  -- ACTION_REQUIRED only: set when the underlying item leaves the pending state
  -- that produced this row (superseded by the next transition), independent of
  -- whether the recipient ever read it. INFO rows never resolve — they're history.
  resolved_at TIMESTAMPTZ
);

-- Primary read path: "my unread/open notifications, newest first".
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON notifications (recipient_user_id, created_at DESC);

-- resolveForObject() targets: "all still-open ACTION_REQUIRED rows for this object".
CREATE INDEX IF NOT EXISTS idx_notifications_open_object
  ON notifications (object_type, object_id)
  WHERE type = 'ACTION_REQUIRED' AND resolved_at IS NULL;
