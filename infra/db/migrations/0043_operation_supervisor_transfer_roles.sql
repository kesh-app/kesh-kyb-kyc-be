-- 0043_operation_supervisor_transfer_roles.sql
-- Update role matrix bisnis:
--   1) Tambah OperationSupervisor sebagai role aktif (menggantikan ComplianceStaff di alur baru)
--   2) ComplianceStaff tetap di CHECK constraint untuk backward-compat existing users
--   3) Tambah transfer_status multi-langkah:
--        SUBMITTED → [OperationSupervisor] → PENDING_FINANCE_STAFF_REVIEW
--                  → [FinanceStaff]        → PENDING_FINANCE_MANAGER_APPROVAL
--                  → [FinanceManager]      → APPROVED
--   4) Tambah kolom audit pada tabel transfers untuk mencatat tiap langkah review
--
-- Idempotent: aman dijalankan ulang (IF NOT EXISTS + guarded DO blocks).
-- Requires PostgreSQL 12+ untuk ALTER TYPE ADD VALUE IF NOT EXISTS di dalam transaksi.

-- ─────────────────────────────────────────────────────────────
-- 1) Tambah OperationSupervisor ke CHECK constraint users.role
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
      'ComplianceStaff',       -- deprecated; backward-compat untuk existing users saja
      'ComplianceLead',
      'OperationSupervisor',   -- baru: menggantikan ComplianceStaff di alur aktif
      'Auditor',
      'FinanceStaff',
      'FinanceManager',
      'SystemAdmin',
      'Director'
    ));
END $$;

INSERT INTO roles(name) VALUES ('OperationSupervisor') ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2) Tambah nilai transfer_status untuk approval 3 langkah
-- ─────────────────────────────────────────────────────────────
ALTER TYPE transfer_status ADD VALUE IF NOT EXISTS 'PENDING_FINANCE_STAFF_REVIEW' AFTER 'SUBMITTED';
ALTER TYPE transfer_status ADD VALUE IF NOT EXISTS 'PENDING_FINANCE_MANAGER_APPROVAL' AFTER 'PENDING_FINANCE_STAFF_REVIEW';

-- ─────────────────────────────────────────────────────────────
-- 3) Kolom audit per langkah review pada tabel transfers
-- ─────────────────────────────────────────────────────────────
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS supervisor_reviewed_by BIGINT REFERENCES users(id);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS supervisor_reviewed_at TIMESTAMPTZ;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS supervisor_notes       TEXT;

ALTER TABLE transfers ADD COLUMN IF NOT EXISTS finance_reviewed_by BIGINT REFERENCES users(id);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS finance_reviewed_at TIMESTAMPTZ;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS finance_notes       TEXT;
