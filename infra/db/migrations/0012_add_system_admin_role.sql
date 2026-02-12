DO $$
BEGIN
  -- Drop constraint lama kalau ada
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users DROP CONSTRAINT users_role_check;
  END IF;

  -- Tambahkan role SystemAdmin
  ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN (
      'BranchAdmin',
      'ComplianceReviewer',
      'ComplianceLead',
      'Auditor',
      'FinanceStaff',
      'FinanceManager',
      'SystemAdmin'
    ));
END $$;

-- Opsional: pastikan ada kolom is_active
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
