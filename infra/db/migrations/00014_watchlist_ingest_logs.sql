CREATE TABLE IF NOT EXISTS watchlist_ingest_logs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id BIGINT REFERENCES users(id),
  list_type TEXT NOT NULL,          -- PEP / DTTOT / PPPSPM
  list_source TEXT NOT NULL,        -- sumber file: PPATK, BNPT, UN, Internal
  original_filename TEXT,           -- nama file yang di-upload
  total_rows INT NOT NULL,          -- total baris di file
  success_rows INT NOT NULL,        -- jumlah baris berhasil di-insert
  error_message TEXT                -- jika ada error saat ingest
);

CREATE INDEX IF NOT EXISTS idx_watchlist_ingest_logs_created_at
  ON watchlist_ingest_logs (created_at DESC);
