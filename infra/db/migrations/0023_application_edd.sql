-- 0023_application_edd.sql
-- Idempotent: EDD (Enhanced Due Diligence) table — wajib untuk aplikasi HIGH RISK

CREATE TABLE IF NOT EXISTS application_edd (
  id                     BIGSERIAL PRIMARY KEY,
  application_id         BIGINT UNIQUE NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  edd_required           BOOLEAN NOT NULL DEFAULT false,
  edd_completed          BOOLEAN NOT NULL DEFAULT false,

  -- Core JSON sections (Lampiran 2 — Formulir EDD APU PPT PPPSPM)
  applicant_snapshot     JSONB NOT NULL DEFAULT '{}',
  high_risk_reasons      JSONB NOT NULL DEFAULT '{}',
  additional_information JSONB NOT NULL DEFAULT '{}',
  beneficial_owner       JSONB NOT NULL DEFAULT '{}',
  officer_analysis       JSONB NOT NULL DEFAULT '{}',
  compliance_decision    JSONB NOT NULL DEFAULT '{}',
  director_decision      JSONB NOT NULL DEFAULT '{}',
  internal_checklist     JSONB NOT NULL DEFAULT '{}',

  -- Audit
  completed_by           BIGINT NULL REFERENCES users(id),
  completed_at           TIMESTAMPTZ NULL,
  created_by             BIGINT NULL REFERENCES users(id),
  updated_by             BIGINT NULL REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_edd_application_id ON application_edd (application_id);
