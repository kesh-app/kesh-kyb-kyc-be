-- 0007_screening_risk.sql (defensive & idempotent)

-- ==== screening_results ====
-- Buat tabel jika belum ada (minimal)
CREATE TABLE IF NOT EXISTS screening_results (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tambahkan kolom yang diperlukan (IF NOT EXISTS agar aman rerun)
ALTER TABLE screening_results
  ADD COLUMN IF NOT EXISTS application_id BIGINT,
  ADD COLUMN IF NOT EXISTS subject_type TEXT,                 -- 'INDIVIDUAL' | 'BUSINESS' | 'PARTY'
  ADD COLUMN IF NOT EXISTS subject_ref BIGINT,
  ADD COLUMN IF NOT EXISTS list_type watchlist_type,          -- PEP / DTTOT / PPPSPM
  ADD COLUMN IF NOT EXISTS watchlist_id BIGINT,
  ADD COLUMN IF NOT EXISTS matched_name TEXT,
  ADD COLUMN IF NOT EXISTS matched_dob DATE,
  ADD COLUMN IF NOT EXISTS matched_nationality TEXT,
  ADD COLUMN IF NOT EXISTS score NUMERIC(5,3);

-- Foreign key (opsional, dilepas biar fleksibel/cepat)
-- ALTER TABLE screening_results
--   ADD CONSTRAINT fk_screening_results_app
--   FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_screening_results_app
  ON screening_results(application_id);

CREATE INDEX IF NOT EXISTS idx_screening_results_score
  ON screening_results(application_id, score DESC);

-- ==== application_risk ====
CREATE TABLE IF NOT EXISTS application_risk (
  application_id BIGINT PRIMARY KEY,
  risk_score NUMERIC(6,2),
  risk_level TEXT,
  factors JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pastikan FK (opsional, bisa dilepas jika kamu mau cepat)
-- DO $$
-- BEGIN
--   IF NOT EXISTS (
--     SELECT 1 FROM information_schema.table_constraints
--     WHERE constraint_name = 'fk_application_risk_app'
--   ) THEN
--     ALTER TABLE application_risk
--       ADD CONSTRAINT fk_application_risk_app
--       FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
--   END IF;
-- END$$;
