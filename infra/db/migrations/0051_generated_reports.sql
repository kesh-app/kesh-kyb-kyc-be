-- 0051_generated_reports.sql
-- Report Center: metadata-only table for async-generated CSV/XLSX reports.
-- The report FILE lives in OBS (private bucket); DB stores only metadata,
-- filters, row counts, checksum, object_key and audit info. Supports both
-- ON_DEMAND and (future) SCHEDULED generation modes.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS generated_reports (
  id               BIGSERIAL PRIMARY KEY,
  report_no        VARCHAR(40) UNIQUE,
  report_type      VARCHAR(20) NOT NULL
                     CHECK (report_type IN ('ALL','KYC_KYB','LTKT','LTKM','TRANSFERS','COMPLAINTS')),
  generation_mode  VARCHAR(20) NOT NULL DEFAULT 'ON_DEMAND'
                     CHECK (generation_mode IN ('ON_DEMAND','SCHEDULED_DAILY','SCHEDULED_MONTHLY')),
  format           VARCHAR(8) NOT NULL CHECK (format IN ('XLSX','CSV')),
  status           VARCHAR(12) NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED','EXPIRED')),
  period_start     TIMESTAMPTZ NOT NULL,
  period_end       TIMESTAMPTZ NOT NULL,
  cutoff_at        TIMESTAMPTZ NULL,
  as_of            TIMESTAMPTZ NOT NULL DEFAULT now(),
  filters          JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_counts       JSONB NOT NULL DEFAULT '{}'::jsonb,
  object_key       TEXT NULL,
  file_name        TEXT NULL,
  file_size        BIGINT NULL,
  checksum_sha256  TEXT NULL,
  generated_by     BIGINT NULL REFERENCES users(id),
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ NULL,
  completed_at     TIMESTAMPTZ NULL,
  error_message    TEXT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generated_reports_report_type     ON generated_reports(report_type);
CREATE INDEX IF NOT EXISTS idx_generated_reports_generation_mode ON generated_reports(generation_mode);
CREATE INDEX IF NOT EXISTS idx_generated_reports_status          ON generated_reports(status);
CREATE INDEX IF NOT EXISTS idx_generated_reports_period          ON generated_reports(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_generated_reports_generated_by    ON generated_reports(generated_by);
CREATE INDEX IF NOT EXISTS idx_generated_reports_created_at      ON generated_reports(created_at);

-- Source-table indexes to keep report range-scans cheap (only columns that exist).
CREATE INDEX IF NOT EXISTS idx_transfers_created_at   ON transfers(created_at);
CREATE INDEX IF NOT EXISTS idx_transfers_submitted_at ON transfers(submitted_at);
CREATE INDEX IF NOT EXISTS idx_transfers_completed_at ON transfers(completed_at);
CREATE INDEX IF NOT EXISTS idx_transfers_status       ON transfers(status);

CREATE INDEX IF NOT EXISTS idx_applications_created_at   ON applications(created_at);
CREATE INDEX IF NOT EXISTS idx_applications_submitted_at ON applications(submitted_at);
CREATE INDEX IF NOT EXISTS idx_applications_decision_at  ON applications(decision_at);
CREATE INDEX IF NOT EXISTS idx_applications_status       ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_type         ON applications(type);

CREATE INDEX IF NOT EXISTS idx_complaints_created_at ON complaints(created_at);
CREATE INDEX IF NOT EXISTS idx_complaints_status     ON complaints(status);

CREATE INDEX IF NOT EXISTS idx_tcr_reported_at ON transfer_compliance_reviews(reported_at);
CREATE INDEX IF NOT EXISTS idx_tcr_reviewed_at ON transfer_compliance_reviews(reviewed_at);
CREATE INDEX IF NOT EXISTS idx_tcr_status      ON transfer_compliance_reviews(status);
