CREATE TABLE IF NOT EXISTS watchlist_ingest_logs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id BIGINT,
  list_type TEXT NOT NULL,
  list_source TEXT NOT NULL,
  original_filename TEXT,
  total_rows INT NOT NULL,
  success_rows INT NOT NULL,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_watchlist_ingest_logs_created_at
  ON watchlist_ingest_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_watchlist_ingest_logs_actor_id
  ON watchlist_ingest_logs (actor_id);
