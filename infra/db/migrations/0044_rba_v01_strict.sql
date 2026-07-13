-- 0044_rba_v01_strict.sql
-- RBA V01 strict — new columns for Risk Profile scoring

-- ── application_risk: RBA V01 result columns ─────────────────────────────────
ALTER TABLE application_risk
  ADD COLUMN IF NOT EXISTS rba_version              VARCHAR(20)  DEFAULT 'RBA_V01',
  ADD COLUMN IF NOT EXISTS rba_score_v01            NUMERIC(5,2) NULL,
  ADD COLUMN IF NOT EXISTS rba_calculation_status   VARCHAR(30)  NOT NULL DEFAULT 'INCOMPLETE',
  ADD COLUMN IF NOT EXISTS rba_unmapped_parameters  JSONB        NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS rba_components           JSONB        NOT NULL DEFAULT '{}';

-- ── persons: CDD fields needed for RBA V01 ───────────────────────────────────
ALTER TABLE persons
  ADD COLUMN IF NOT EXISTS source_of_funds              VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS business_relationship_purpose VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS distribution_channel         VARCHAR(100) NULL;

-- ── business_entities: same CDD fields ───────────────────────────────────────
ALTER TABLE business_entities
  ADD COLUMN IF NOT EXISTS source_of_funds              VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS business_relationship_purpose VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS distribution_channel         VARCHAR(100) NULL;
