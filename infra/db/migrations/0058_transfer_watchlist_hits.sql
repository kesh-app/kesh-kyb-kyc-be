-- 0058_transfer_watchlist_hits.sql
-- Screening beneficiary transfer terhadap watchlist (DTTOT / PPPSPM / PEP).
--
-- Sebelumnya matching watchlist HANYA berjalan di ApplicationsService.screenAndComputeRisk()
-- (submit KYC/KYB). Transfer tidak pernah di-screen, sehingga beneficiary yang persis
-- ada di DTTOT tetap lolos ke alur bersih.
--
-- Tabel ini menyimpan hit per transfer untuk audit. screening_results TIDAK dipakai
-- karena terikat application_id (FK ke applications) dan kolom entity_ref/ref_id NOT NULL.
--
-- Idempotent: aman dijalankan ulang.

CREATE TABLE IF NOT EXISTS transfer_watchlist_hits (
  id                 BIGSERIAL PRIMARY KEY,
  transfer_id        BIGINT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  -- nullable: entry watchlist boleh dihapus tanpa menghilangkan jejak audit hit.
  watchlist_entry_id BIGINT NULL REFERENCES watchlist_entries(id) ON DELETE SET NULL,
  list_type          TEXT NOT NULL,
  input_name         TEXT NOT NULL,
  matched_name       TEXT NULL,
  -- FULL_NAME | ENTITY_NAME | ALIAS_NAME
  matched_field      TEXT NULL,
  match_score        NUMERIC(5,3) NULL,
  unique_id          TEXT NULL,
  -- PERSON | ENTITY (dari watchlist_entries.subject_type, boleh NULL)
  subject_type       TEXT NULL,
  raw_hit            JSONB NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transfer_watchlist_hits_transfer_id
  ON transfer_watchlist_hits(transfer_id);

-- Safety net anti-duplikat bila submit dijalankan ulang. Service sudah
-- delete-then-insert per transfer (konsisten dengan screenAndComputeRisk),
-- index ini menjaga invarian di level DB.
CREATE UNIQUE INDEX IF NOT EXISTS uq_transfer_watchlist_hits_entry
  ON transfer_watchlist_hits(transfer_id, watchlist_entry_id)
  WHERE watchlist_entry_id IS NOT NULL;
