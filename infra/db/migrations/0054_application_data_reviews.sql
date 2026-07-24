-- 0054_application_data_reviews.sql
-- Pengkinian Data / Periodic Customer Data Review — foundation workflow + audit.
-- Record ini melacak workflow/audit review; data pengguna jasa yang diperbarui
-- tetap disimpan di tabel applications/persons/business_entities yang sudah ada
-- (tidak diduplikasi di sini).
--
-- Periode jatuh tempo dihitung dari first_submitted_at (fallback submitted_at):
--   HIGH   → base + 1 tahun
--   MEDIUM → base + 2 tahun
--   LOW    → base + 3 tahun
--
-- Idempotent: aman dijalankan ulang.

CREATE TABLE IF NOT EXISTS application_data_reviews (
  id                   BIGSERIAL PRIMARY KEY,
  application_id       BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  review_no            VARCHAR(40) NOT NULL UNIQUE,
  review_type          VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
                         CHECK (review_type IN ('PERIODIC','MANUAL')),
  risk_level_at_review VARCHAR(10) NULL
                         CHECK (risk_level_at_review IN ('LOW','MEDIUM','HIGH')),
  base_submitted_at    TIMESTAMPTZ NULL,
  due_at               TIMESTAMPTZ NULL,
  status               VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN (
                           'DRAFT',
                           'SUBMITTED',
                           'IN_COMPLIANCE_REVIEW',
                           'APPROVED',
                           'RETURNED_FOR_REVISION',
                           'REJECTED',
                           'CANCELLED'
                         )),
  initiated_by         BIGINT NULL REFERENCES users(id),
  initiated_at         TIMESTAMPTZ NULL,
  submitted_by         BIGINT NULL REFERENCES users(id),
  submitted_at         TIMESTAMPTZ NULL,
  reviewed_by          BIGINT NULL REFERENCES users(id),
  reviewed_at          TIMESTAMPTZ NULL,
  decision_notes       TEXT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_data_reviews_app    ON application_data_reviews(application_id);
CREATE INDEX IF NOT EXISTS idx_application_data_reviews_status ON application_data_reviews(status);
