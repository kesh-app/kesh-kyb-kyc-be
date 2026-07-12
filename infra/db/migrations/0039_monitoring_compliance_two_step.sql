-- 0039_monitoring_compliance_two_step.sql
-- Ubah workflow approval monitoring LTKT/LTKM menjadi 2 langkah internal compliance:
--   1) Approval pertama  : ComplianceStaff (staff-review)
--   2) Approval kedua     : ComplianceLead / Compliance Manager (manager-review)
-- Director/Dirut TIDAK lagi menjadi approver monitoring.
--
-- Idempotent: aman dijalankan ulang (IF NOT EXISTS + guarded DO blocks).
-- TIDAK mengubah detection rules, alert information, atau report queue logic
-- (selain sumber approval). Kolom & status lama dipertahankan untuk backward-compat.

-- ─────────────────────────────────────────────────────────────
-- 1) Role baru: ComplianceStaff
--    Tambahkan ke CHECK constraint users.role + tabel lookup roles.
--    Director tetap ada di constraint (backward-compat) tapi tidak lagi
--    dipakai untuk approval monitoring.
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
      'ComplianceStaff',
      'ComplianceLead',
      'Auditor',
      'FinanceStaff',
      'FinanceManager',
      'SystemAdmin',
      'Director'
    ));
END $$;

INSERT INTO roles(name) VALUES ('ComplianceStaff') ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2) Kolom review 2 langkah pada monitoring_cases
-- ─────────────────────────────────────────────────────────────
ALTER TABLE monitoring_cases
  ADD COLUMN IF NOT EXISTS staff_reviewed_by   BIGINT NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS staff_reviewed_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS staff_action        VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS staff_notes         TEXT NULL,
  ADD COLUMN IF NOT EXISTS manager_reviewed_by BIGINT NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS manager_reviewed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS manager_action      VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS manager_notes       TEXT NULL;

-- ─────────────────────────────────────────────────────────────
-- 3) Lepas dulu CHECK status lama supaya migrasi data & status baru sah.
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'monitoring_cases_status_check') THEN
    ALTER TABLE monitoring_cases DROP CONSTRAINT monitoring_cases_status_check;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 4) Migrasi data existing dari flow Director → flow Compliance 2 langkah.
--    - compliance_review lama menjadi review Staff (langkah pertama)
--    - director_review lama menjadi review Manager (langkah kedua)
-- ─────────────────────────────────────────────────────────────

-- 4a) Copy field compliance_review lama → staff_review (bila belum terisi).
UPDATE monitoring_cases
SET staff_reviewed_by = compliance_reviewed_by,
    staff_reviewed_at = compliance_reviewed_at,
    staff_notes       = COALESCE(staff_notes, compliance_notes),
    staff_action = CASE compliance_action
      WHEN 'ESCALATE_TO_DIRECTOR' THEN 'ESCALATE_TO_MANAGER'
      WHEN 'RECOMMEND_REPORT'     THEN 'ESCALATE_TO_MANAGER'
      WHEN 'READY_TO_REPORT'      THEN 'ESCALATE_TO_MANAGER'
      WHEN 'NEED_CLARIFICATION'   THEN 'REQUEST_CLARIFICATION'
      WHEN 'CLOSE_FALSE_POSITIVE' THEN 'RECOMMEND_CLOSE_FALSE_POSITIVE'
      ELSE NULL
    END
WHERE compliance_reviewed_by IS NOT NULL
  AND staff_reviewed_by IS NULL;

-- 4b) Copy field director_review lama → manager_review (bila belum terisi).
UPDATE monitoring_cases
SET manager_reviewed_by = director_reviewed_by,
    manager_reviewed_at = director_reviewed_at,
    manager_notes       = COALESCE(manager_notes, director_notes),
    manager_action = CASE director_decision
      WHEN 'APPROVED'         THEN 'APPROVE_REPORT'
      WHEN 'REJECTED'         THEN 'REJECT'
      WHEN 'REQUEST_MORE_INFO' THEN 'REQUEST_CLARIFICATION'
      ELSE NULL
    END
WHERE director_reviewed_by IS NOT NULL
  AND manager_reviewed_by IS NULL;

-- 4c) Remap status lama → status baru.
UPDATE monitoring_cases SET status = 'PENDING_COMPLIANCE_MANAGER_REVIEW'
  WHERE status = 'PENDING_DIRECTOR_REVIEW';
UPDATE monitoring_cases SET status = 'MANAGER_APPROVED'
  WHERE status = 'DIRECTOR_APPROVED';
UPDATE monitoring_cases SET status = 'MANAGER_REJECTED'
  WHERE status = 'DIRECTOR_REJECTED';
-- Status compliance-only lama (jarang) dipetakan ke ekuivalen manager.
UPDATE monitoring_cases SET status = 'MANAGER_REJECTED'
  WHERE status = 'COMPLIANCE_REJECTED';
UPDATE monitoring_cases SET status = 'STAFF_REVIEWED'
  WHERE status IN ('UNDER_COMPLIANCE_REVIEW', 'COMPLIANCE_APPROVED');

-- ─────────────────────────────────────────────────────────────
-- 5) Pasang kembali CHECK status dengan daftar lengkap (baru + lama).
--    Status lama tetap diizinkan agar backward-compatible, tapi tidak
--    dipakai pada flow baru.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE monitoring_cases
  ADD CONSTRAINT monitoring_cases_status_check
  CHECK (status IN (
    -- flow baru
    'DETECTED',
    'PENDING_COMPLIANCE_STAFF_REVIEW',
    'STAFF_REVIEWED',
    'PENDING_COMPLIANCE_MANAGER_REVIEW',
    'MANAGER_APPROVED',
    'MANAGER_REJECTED',
    'READY_TO_REPORT',
    'REPORTED',
    'CLOSED_FALSE_POSITIVE',
    'NEED_CLARIFICATION',
    'ARCHIVED',
    -- status lama (deprecated, disimpan untuk backward-compat)
    'UNDER_COMPLIANCE_REVIEW',
    'COMPLIANCE_APPROVED',
    'COMPLIANCE_REJECTED',
    'PENDING_DIRECTOR_REVIEW',
    'DIRECTOR_APPROVED',
    'DIRECTOR_REJECTED'
  ));

-- ─────────────────────────────────────────────────────────────
-- 6) CHECK constraint untuk staff_action & manager_action (nullable).
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'monitoring_cases_staff_action_check') THEN
    ALTER TABLE monitoring_cases
      ADD CONSTRAINT monitoring_cases_staff_action_check
      CHECK (staff_action IS NULL OR staff_action IN (
        'ESCALATE_TO_MANAGER',
        'REQUEST_CLARIFICATION',
        'RECOMMEND_CLOSE_FALSE_POSITIVE'
      ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'monitoring_cases_manager_action_check') THEN
    ALTER TABLE monitoring_cases
      ADD CONSTRAINT monitoring_cases_manager_action_check
      CHECK (manager_action IS NULL OR manager_action IN (
        'APPROVE_REPORT',
        'CLOSE_FALSE_POSITIVE',
        'REJECT',
        'REQUEST_CLARIFICATION'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_monitoring_cases_staff_reviewed_by   ON monitoring_cases(staff_reviewed_by);
CREATE INDEX IF NOT EXISTS idx_monitoring_cases_manager_reviewed_by ON monitoring_cases(manager_reviewed_by);
