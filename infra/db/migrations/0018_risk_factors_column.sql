-- 0018_risk_factors_column.sql
-- Tambahkan kolom risk_factors ke application_risk untuk Risk Based Approach v2.
-- risk_factors menyimpan array faktor terstruktur per-item dengan code, label, score, severity.
-- Idempotent: ADD COLUMN IF NOT EXISTS, default [] agar row lama tetap valid.

ALTER TABLE application_risk
  ADD COLUMN IF NOT EXISTS risk_factors JSONB NOT NULL DEFAULT '[]'::jsonb;
