-- 0027_transaction_monitoring.sql
-- Transaction Monitoring internal untuk deteksi trigger LTKT & LTKM.
-- Idempotent: aman dijalankan ulang (IF NOT EXISTS + guarded DO blocks).
-- TIDAK mengubah watchlist / EDD / CIF / transfer flow existing.
-- Belum ada integrasi goAML — hanya internal monitoring + report queue tracking.

-- ─────────────────────────────────────────────────────────────
-- 1) Role baru: Director (Direktur Utama)
--    Tambahkan ke CHECK constraint users.role + tabel lookup roles.
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users DROP CONSTRAINT users_role_check;
  END IF;

  ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN (
      'BranchAdmin',
      'FrontDesk',
      'ComplianceLead',
      'Auditor',
      'FinanceStaff',
      'FinanceManager',
      'SystemAdmin',
      'Director'
    ));
END $$;

INSERT INTO roles(name) VALUES ('Director') ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2) Sequence penomoran case: MON-YYYYMMDD-<SEQ6>
-- ─────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS monitoring_case_seq START 1;

-- ─────────────────────────────────────────────────────────────
-- 3) monitoring_cases
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitoring_cases (
  id                    BIGSERIAL PRIMARY KEY,
  case_no               VARCHAR(64) UNIQUE NOT NULL,
  case_type             VARCHAR(16) NOT NULL
                          CHECK (case_type IN ('LTKT','LTKM','BOTH')),
  source_type           VARCHAR(32) NOT NULL
                          CHECK (source_type IN ('TRANSFER','MANUAL','APPLICATION')),
  source_id             BIGINT NULL,
  transfer_id           BIGINT NULL REFERENCES transfers(id),
  application_id        BIGINT NULL REFERENCES applications(id),
  cif_no                VARCHAR(32) NULL,
  customer_name         VARCHAR(255) NULL,

  status                VARCHAR(40) NOT NULL DEFAULT 'DETECTED'
                          CHECK (status IN (
                            'DETECTED',
                            'UNDER_COMPLIANCE_REVIEW',
                            'NEED_CLARIFICATION',
                            'CLOSED_FALSE_POSITIVE',
                            'COMPLIANCE_APPROVED',
                            'COMPLIANCE_REJECTED',
                            'PENDING_DIRECTOR_REVIEW',
                            'DIRECTOR_APPROVED',
                            'DIRECTOR_REJECTED',
                            'READY_TO_REPORT',
                            'REPORTED',
                            'ARCHIVED'
                          )),
  severity              VARCHAR(16) NOT NULL DEFAULT 'MEDIUM'
                          CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  detected_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date              TIMESTAMPTZ NULL,
  trigger_summary       TEXT NULL,
  trigger_details       JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Compliance review
  compliance_status     VARCHAR(32) NULL,
  compliance_notes      TEXT NULL,
  compliance_action     VARCHAR(40) NULL
                          CHECK (compliance_action IS NULL OR compliance_action IN (
                            'CLOSE_FALSE_POSITIVE',
                            'NEED_CLARIFICATION',
                            'ESCALATE_TO_DIRECTOR',
                            'READY_TO_REPORT',
                            'RECOMMEND_REPORT'
                          )),
  compliance_reviewed_by BIGINT NULL REFERENCES users(id),
  compliance_reviewed_at TIMESTAMPTZ NULL,

  -- Director review
  director_decision     VARCHAR(40) NULL
                          CHECK (director_decision IS NULL OR director_decision IN (
                            'APPROVED',
                            'REJECTED',
                            'REQUEST_MORE_INFO'
                          )),
  director_notes        TEXT NULL,
  director_reviewed_by  BIGINT NULL REFERENCES users(id),
  director_reviewed_at  TIMESTAMPTZ NULL,

  -- Report tracking
  report_type           VARCHAR(16) NULL
                          CHECK (report_type IS NULL OR report_type IN ('LTKT','LTKM')),
  report_status         VARCHAR(32) NULL
                          CHECK (report_status IS NULL OR report_status IN (
                            'DRAFT',
                            'READY_TO_SUBMIT',
                            'SUBMITTED',
                            'REJECTED_BY_REGULATOR',
                            'ARCHIVED'
                          )),
  report_reference_no   VARCHAR(100) NULL,
  report_file_uri       TEXT NULL,
  reported_at           TIMESTAMPTZ NULL,
  reported_by           BIGINT NULL REFERENCES users(id),

  -- Audit
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            BIGINT NULL REFERENCES users(id),
  updated_by            BIGINT NULL REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_monitoring_cases_status         ON monitoring_cases(status);
CREATE INDEX IF NOT EXISTS idx_monitoring_cases_case_type      ON monitoring_cases(case_type);
CREATE INDEX IF NOT EXISTS idx_monitoring_cases_application_id ON monitoring_cases(application_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_cases_transfer_id    ON monitoring_cases(transfer_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_cases_cif_no         ON monitoring_cases(cif_no);
CREATE INDEX IF NOT EXISTS idx_monitoring_cases_detected_at    ON monitoring_cases(detected_at);
CREATE INDEX IF NOT EXISTS idx_monitoring_cases_due_date       ON monitoring_cases(due_date);
CREATE INDEX IF NOT EXISTS idx_monitoring_cases_report_status  ON monitoring_cases(report_status);

-- ─────────────────────────────────────────────────────────────
-- 4) monitoring_case_triggers
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitoring_case_triggers (
  id           BIGSERIAL PRIMARY KEY,
  case_id      BIGINT NOT NULL REFERENCES monitoring_cases(id) ON DELETE CASCADE,
  trigger_type VARCHAR(16) NOT NULL CHECK (trigger_type IN ('LTKT','LTKM')),
  rule_code    VARCHAR(80) NOT NULL,
  rule_name    VARCHAR(200) NOT NULL,
  severity     VARCHAR(16) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  score        INTEGER NULL,
  amount       NUMERIC(18,2) NULL,
  details      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monitoring_triggers_case_id   ON monitoring_case_triggers(case_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_triggers_rule_code ON monitoring_case_triggers(rule_code);
