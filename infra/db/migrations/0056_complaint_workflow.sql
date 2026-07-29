-- 0056_complaint_workflow.sql
-- Menu Pencatatan Pengaduan — upgrade workflow:
--   1) Role baru ComplaintHandling (pemilik tiket pengaduan). FrontDesk tetap ada
--      sebagai role, tapi tidak lagi punya akses ke modul complaint.
--   2) complaint_level (LEVEL_1..LEVEL_3) + level_3_risk_category
--   3) Status workflow multi-tahap + kolom audit per tahap
--
-- Alur:
--   OPEN → [ComplaintHandling verify-data]
--     INCOMPLETE → WAITING_CUSTOMER_DATA
--     COMPLETE   → OPERATION_INVESTIGATION
--   OPERATION_INVESTIGATION → [OperationSupervisor operation-investigation]
--     SUCCESS → RESOLVED | PENDING → WAITING_BANK_CONFIRMATION
--     RETURNED/NEED_FINANCE_REVIEW → FINANCE_REVIEW | NEED_AML_REVIEW → AML_REVIEW
--   AML_REVIEW → [ComplianceLead aml-review] APPROVE → OPERATION_INVESTIGATION,
--                HOLD → AML_HOLD, REJECT → REJECTED
--   FINANCE_REVIEW → [FinanceStaff finance-review] NO_REFUND → RESOLVED,
--                REFUND_REQUIRED → REFUND_PROCESS (refund dibuat di modul statement-refunds)
--   RESOLVED/REJECTED → [ComplaintHandling close] → CLOSED
--
-- Idempotent: aman dijalankan ulang.

-- ─────────────────────────────────────────────────────────────
-- 1) Role ComplaintHandling
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
      'FrontDesk',              -- masih dipakai KYC/KYB & transfer, TIDAK untuk complaint
      'ComplaintHandling',      -- baru: pemilik tiket pengaduan
      'ComplianceStaff',        -- deprecated; backward-compat untuk existing users saja
      'ComplianceLead',
      'OperationSupervisor',
      'Auditor',
      'FinanceStaff',
      'FinanceManager',
      'SystemAdmin',
      'Director'
    ));
END $$;

INSERT INTO roles(name) VALUES ('ComplaintHandling') ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2) Level & kategori risiko
-- ─────────────────────────────────────────────────────────────
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS complaint_level        VARCHAR(20) NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS level_3_risk_category  VARCHAR(30) NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_level_check') THEN
    ALTER TABLE complaints DROP CONSTRAINT complaints_level_check;
  END IF;
  ALTER TABLE complaints ADD CONSTRAINT complaints_level_check
    CHECK (complaint_level IS NULL OR complaint_level IN ('LEVEL_1','LEVEL_2','LEVEL_3'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_level3_category_check') THEN
    ALTER TABLE complaints DROP CONSTRAINT complaints_level3_category_check;
  END IF;
  ALTER TABLE complaints ADD CONSTRAINT complaints_level3_category_check
    CHECK (level_3_risk_category IS NULL OR level_3_risk_category IN (
      'FRAUD_SECURITY','LEGAL_RISK','REPUTATION_RISK','COMPLIANCE_RISK','FINANCIAL_IMPACT'));
END $$;

-- ─────────────────────────────────────────────────────────────
-- 3) Kolom workflow per tahap
-- ─────────────────────────────────────────────────────────────
-- Verifikasi data (ComplaintHandling)
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS data_verification_status VARCHAR(20) NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS data_verification_notes  TEXT NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS data_verified_by         BIGINT NULL REFERENCES users(id);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS data_verified_at         TIMESTAMPTZ NULL;

-- Investigasi transaksi (OperationSupervisor)
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS operation_investigation_result VARCHAR(30) NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS operation_investigation_notes  TEXT NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS operation_investigated_by      BIGINT NULL REFERENCES users(id);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS operation_investigated_at      TIMESTAMPTZ NULL;

-- AML / Compliance review (ComplianceLead)
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS aml_decision    VARCHAR(20) NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS aml_notes       TEXT NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS aml_reviewed_by BIGINT NULL REFERENCES users(id);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS aml_reviewed_at TIMESTAMPTZ NULL;

-- Finance review (FinanceStaff) — approval refund tetap di modul statement-refunds
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS finance_decision     VARCHAR(20) NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS finance_review_notes TEXT NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS finance_reviewed_by  BIGINT NULL REFERENCES users(id);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS finance_reviewed_at  TIMESTAMPTZ NULL;

-- Komunikasi customer & penutupan (ComplaintHandling)
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS customer_communication_notes TEXT NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS closing_notes                TEXT NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS closed_by                    BIGINT NULL REFERENCES users(id);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS closed_at                    TIMESTAMPTZ NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_verification_status_check') THEN
    ALTER TABLE complaints DROP CONSTRAINT complaints_verification_status_check;
  END IF;
  ALTER TABLE complaints ADD CONSTRAINT complaints_verification_status_check
    CHECK (data_verification_status IS NULL OR data_verification_status IN ('COMPLETE','INCOMPLETE'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_investigation_result_check') THEN
    ALTER TABLE complaints DROP CONSTRAINT complaints_investigation_result_check;
  END IF;
  ALTER TABLE complaints ADD CONSTRAINT complaints_investigation_result_check
    CHECK (operation_investigation_result IS NULL OR operation_investigation_result IN (
      'SUCCESS','PENDING','FAILED','RETURNED','NEED_AML_REVIEW','NEED_FINANCE_REVIEW'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_aml_decision_check') THEN
    ALTER TABLE complaints DROP CONSTRAINT complaints_aml_decision_check;
  END IF;
  ALTER TABLE complaints ADD CONSTRAINT complaints_aml_decision_check
    CHECK (aml_decision IS NULL OR aml_decision IN ('APPROVE','REJECT','HOLD'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_finance_decision_check') THEN
    ALTER TABLE complaints DROP CONSTRAINT complaints_finance_decision_check;
  END IF;
  ALTER TABLE complaints ADD CONSTRAINT complaints_finance_decision_check
    CHECK (finance_decision IS NULL OR finance_decision IN ('NO_REFUND','REFUND_REQUIRED'));
END $$;

-- ─────────────────────────────────────────────────────────────
-- 4) Status workflow
--    Record lama tidak diubah: OPEN/RESOLVED/CLOSED/REJECTED tetap valid,
--    IN_PROGRESS tetap diterima CHECK sebagai kompatibilitas data lama
--    (tidak dipakai lagi oleh backend; padanan barunya OPERATION_INVESTIGATION).
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_status_check') THEN
    ALTER TABLE complaints DROP CONSTRAINT complaints_status_check;
  END IF;
  ALTER TABLE complaints ADD CONSTRAINT complaints_status_check
    CHECK (status IN (
      'OPEN',
      'WAITING_CUSTOMER_DATA',
      'OPERATION_INVESTIGATION',
      'WAITING_BANK_CONFIRMATION',
      'AML_REVIEW',
      'AML_HOLD',
      'FINANCE_REVIEW',
      'REFUND_PROCESS',
      'REFUNDED',
      'RESOLVED',
      'CLOSED',
      'REJECTED',
      'IN_PROGRESS'  -- legacy
    ));
END $$;

CREATE INDEX IF NOT EXISTS idx_complaints_complaint_level ON complaints(complaint_level);
