-- 0070_complaint_coo_level_workflow.sql
-- Pencatatan Pengaduan — routing berbasis complaint_level dengan layer COO.
--
--   1) Role baru COO. BUKAN alias Director: tidak masuk bypass RolesGuard,
--      hanya dapat izin yang dibutuhkan modul complaint.
--   2) Status eksplisit per tahap baru. Status lama TIDAK dihapus/di-rename —
--      record historis (AML_REVIEW, FINANCE_REVIEW, REFUND_PROCESS, IN_PROGRESS)
--      tetap valid dan tetap bisa dibaca/diselesaikan lewat jalur lamanya.
--   3) Kolom keputusan COO dan FinanceManager. Kolom aktor lama tidak ditimpa.
--
-- Alur baru (berlaku untuk transisi setelah migrasi ini):
--   OPEN → [ComplaintHandling verify-data]
--     INCOMPLETE → WAITING_CUSTOMER_DATA
--     COMPLETE   → OPERATION_INVESTIGATION
--   OPERATION_INVESTIGATION → [OperationSupervisor] → COO_REVIEW
--     (PENDING tetap → WAITING_BANK_CONFIRMATION)
--   COO_REVIEW → [COO coo-review]
--     APPROVE + LEVEL_1 → COMPLAINT_HANDLING_FINALIZATION
--     APPROVE + LEVEL_2 → FINANCE_STAFF_REVIEW
--     APPROVE + LEVEL_3 → COMPLIANCE_REVIEW
--     RETURN_TO_SUPERVISOR → OPERATION_INVESTIGATION
--   FINANCE_STAFF_REVIEW    → [FinanceStaff]   APPROVE → FINANCE_MANAGER_REVIEW | RETURN → COO_REVIEW
--   FINANCE_MANAGER_REVIEW  → [FinanceManager] APPROVE → COMPLAINT_HANDLING_FINALIZATION | RETURN → FINANCE_STAFF_REVIEW
--   COMPLIANCE_REVIEW       → [ComplianceLead] APPROVE/REJECT → COMPLAINT_HANDLING_FINALIZATION
--                                              HOLD → COMPLIANCE_HOLD | RETURN → COO_REVIEW
--   COMPLIANCE_HOLD         → [ComplianceLead] RESUME → COMPLIANCE_REVIEW
--   COMPLAINT_HANDLING_FINALIZATION → [ComplaintHandling] resolve → RESOLVED → close → CLOSED
--
-- Status alur baru dan status legacy sengaja tidak saling tumpang tindih
-- (COMPLIANCE_HOLD vs AML_HOLD, FINANCE_STAFF_REVIEW vs FINANCE_REVIEW), jadi
-- routing cukup ditentukan status — tidak perlu penanda alur tambahan.
-- REFUND_PROCESS tetap ada untuk tiket lama, tapi TIDAK pernah jadi tujuan
-- routing alur berbasis level.
--
-- Tidak ada backfill status: complaint aktif yang sudah terlanjur di jalur lama
-- diselesaikan dengan jalur lama. Migrasi ini murni aditif.
-- Idempotent: aman dijalankan ulang.

-- ─────────────────────────────────────────────────────────────
-- 1) Role COO
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
      'ComplaintHandling',
      'ComplianceStaff',        -- deprecated; backward-compat untuk existing users saja
      'ComplianceLead',
      'OperationSupervisor',
      'COO',                    -- baru: layer review direksi di alur pengaduan
      'Auditor',
      'FinanceStaff',
      'FinanceManager',
      'SystemAdmin',
      'Director'
    ));
END $$;

INSERT INTO roles(name) VALUES ('COO') ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2) Kolom keputusan COO
-- ─────────────────────────────────────────────────────────────
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS coo_decision    VARCHAR(30) NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS coo_notes       TEXT NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS coo_reviewed_by BIGINT NULL REFERENCES users(id);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS coo_reviewed_at TIMESTAMPTZ NULL;

-- ─────────────────────────────────────────────────────────────
-- 3) Kolom keputusan Finance Manager — terpisah dari FinanceStaff
--    (finance_decision/finance_reviewed_by TIDAK ditimpa).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS finance_manager_decision    VARCHAR(20) NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS finance_manager_notes       TEXT NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS finance_manager_reviewed_by BIGINT NULL REFERENCES users(id);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS finance_manager_reviewed_at TIMESTAMPTZ NULL;

-- ─────────────────────────────────────────────────────────────
-- 4) CHECK keputusan
--    finance_decision & aml_decision menampung nilai lama + nilai alur baru;
--    kombinasi mana yang sah di tahap mana ditegakkan di service layer.
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_coo_decision_check') THEN
    ALTER TABLE complaints DROP CONSTRAINT complaints_coo_decision_check;
  END IF;
  ALTER TABLE complaints ADD CONSTRAINT complaints_coo_decision_check
    CHECK (coo_decision IS NULL OR coo_decision IN ('APPROVE','RETURN_TO_SUPERVISOR'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_finance_manager_decision_check') THEN
    ALTER TABLE complaints DROP CONSTRAINT complaints_finance_manager_decision_check;
  END IF;
  ALTER TABLE complaints ADD CONSTRAINT complaints_finance_manager_decision_check
    CHECK (finance_manager_decision IS NULL OR finance_manager_decision IN ('APPROVE','RETURN'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_finance_decision_check') THEN
    ALTER TABLE complaints DROP CONSTRAINT complaints_finance_decision_check;
  END IF;
  ALTER TABLE complaints ADD CONSTRAINT complaints_finance_decision_check
    CHECK (finance_decision IS NULL OR finance_decision IN (
      'NO_REFUND','REFUND_REQUIRED',  -- legacy (tahap FINANCE_REVIEW/REFUND_PROCESS)
      'APPROVE','RETURN'));           -- alur level (tahap FINANCE_STAFF_REVIEW)

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_aml_decision_check') THEN
    ALTER TABLE complaints DROP CONSTRAINT complaints_aml_decision_check;
  END IF;
  ALTER TABLE complaints ADD CONSTRAINT complaints_aml_decision_check
    CHECK (aml_decision IS NULL OR aml_decision IN (
      'APPROVE','REJECT','HOLD',  -- legacy (AML_REVIEW/AML_HOLD) + alur level
      'RETURN','RESUME'));        -- alur level saja
END $$;

-- ─────────────────────────────────────────────────────────────
-- 5) Status workflow — aditif, tidak ada nilai lama yang dibuang
--
--    'COMPLAINT_HANDLING_FINALIZATION' panjangnya 31 karakter, sedangkan
--    complaints.status masih VARCHAR(30) sejak 0038 — kolomnya harus dilebarkan
--    dulu atau setiap transisi ke tahap finalisasi gagal saat INSERT/UPDATE
--    (CHECK constraint menerima nilainya, tapi tipe kolomnya menolak).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE complaints ALTER COLUMN status TYPE VARCHAR(40);

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
      'COO_REVIEW',                       -- baru
      'FINANCE_STAFF_REVIEW',             -- baru
      'FINANCE_MANAGER_REVIEW',           -- baru
      'COMPLIANCE_REVIEW',                -- baru
      'COMPLIANCE_HOLD',                  -- baru; hold alur level, TERPISAH dari AML_HOLD
      'COMPLAINT_HANDLING_FINALIZATION',  -- baru
      'AML_REVIEW',      -- legacy
      'AML_HOLD',        -- legacy; tiket lama TIDAK dimigrasikan ke COMPLIANCE_HOLD
      'FINANCE_REVIEW',  -- legacy
      'REFUND_PROCESS',  -- legacy; bukan tujuan routing alur level
      'REFUNDED',        -- legacy
      'RESOLVED',
      'CLOSED',
      'REJECTED',
      'IN_PROGRESS'      -- legacy
    ));
END $$;

CREATE INDEX IF NOT EXISTS idx_complaints_coo_reviewed_by ON complaints(coo_reviewed_by);
