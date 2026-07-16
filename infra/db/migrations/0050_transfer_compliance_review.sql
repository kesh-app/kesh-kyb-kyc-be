-- 0050_transfer_compliance_review.sql
-- Compliance Review flow untuk transfer yang di-flag (red flag) sebelum masuk
-- approval Operation Supervisor.
--
-- Alur flagged:
--   DRAFT → [FrontDesk submit-compliance-review] → PENDING_COMPLIANCE_REVIEW
--         → [ComplianceLead APPROVE_TO_CONTINUE]  → SUBMITTED (lanjut alur normal)
--         → [ComplianceLead REJECT]               → REJECTED
--   Aksi REQUEST_ADDITIONAL_INFO / REQUEST_EDD / MARK_LTKM_CANDIDATE menahan
--   transfer tetap di PENDING_COMPLIANCE_REVIEW (blocked dari Operation Supervisor)
--   sampai ComplianceLead melakukan APPROVE_TO_CONTINUE atau REJECT.
--
-- Alur normal (tidak di-flag) TIDAK berubah: DRAFT → SUBMITTED.
--
-- Idempotent: aman dijalankan ulang (IF NOT EXISTS + guarded).
-- Requires PostgreSQL 12+ untuk ALTER TYPE ADD VALUE IF NOT EXISTS dalam transaksi.

-- ─────────────────────────────────────────────────────────────
-- 1) Tambah nilai status transfer baru: PENDING_COMPLIANCE_REVIEW
--    Tidak dipakai dalam DML di migrasi ini (hanya dipakai runtime service),
--    sehingga aman ADD VALUE dalam transaksi yang sama.
-- ─────────────────────────────────────────────────────────────
ALTER TYPE transfer_status ADD VALUE IF NOT EXISTS 'PENDING_COMPLIANCE_REVIEW' AFTER 'DRAFT';

-- ─────────────────────────────────────────────────────────────
-- 2) Tabel audit review compliance untuk transfer
--    Pendekatan: satu baris review per "episode" flag. Baris di-update in place
--    oleh setiap aksi ComplianceLead (status mencerminkan aksi terakhir).
--    Aksi APPROVE_TO_CONTINUE / REJECT bersifat terminal; aksi lain (REQUEST_*,
--    LTKM_CANDIDATE) menahan transfer tetap PENDING_COMPLIANCE_REVIEW.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfer_compliance_reviews (
  id             BIGSERIAL PRIMARY KEY,
  transfer_id    BIGINT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  status         VARCHAR(40) NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN (
                     'OPEN',
                     'APPROVED_TO_CONTINUE',
                     'REJECTED',
                     'REQUEST_ADDITIONAL_INFO',
                     'REQUEST_EDD',
                     'LTKM_CANDIDATE'
                   )),
  red_flags      JSONB NOT NULL DEFAULT '[]'::jsonb,
  report_notes   TEXT NULL,
  reported_by    BIGINT NOT NULL REFERENCES users(id),
  reported_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by    BIGINT NULL REFERENCES users(id),
  reviewed_at    TIMESTAMPTZ NULL,
  decision_notes TEXT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transfer_compliance_reviews_transfer_id ON transfer_compliance_reviews(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_compliance_reviews_status      ON transfer_compliance_reviews(status);
CREATE INDEX IF NOT EXISTS idx_transfer_compliance_reviews_reported_by ON transfer_compliance_reviews(reported_by);
