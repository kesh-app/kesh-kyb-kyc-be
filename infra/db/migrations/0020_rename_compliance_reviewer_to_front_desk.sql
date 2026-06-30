-- Rename role ComplianceReviewer -> FrontDesk
-- Permission FrontDesk identik dengan ComplianceReviewer sebelumnya (hanya rename).
-- Aman dijalankan ulang (idempotent): migration runner sudah men-track applied state,
-- tapi statement di bawah juga ditulis agar tidak error bila dijalankan dua kali.

DO $$
BEGIN
  -- 1) Lepas CHECK constraint dulu supaya update role tidak ditolak constraint lama
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users DROP CONSTRAINT users_role_check;
  END IF;

  -- 2) Migrasikan user lama ComplianceReviewer -> FrontDesk
  UPDATE users SET role = 'FrontDesk' WHERE role = 'ComplianceReviewer';

  -- 3) Pasang kembali CHECK constraint: terima FrontDesk, tidak lagi ComplianceReviewer
  ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN (
      'BranchAdmin',
      'FrontDesk',
      'ComplianceLead',
      'Auditor',
      'FinanceStaff',
      'FinanceManager',
      'SystemAdmin'
    ));
END $$;

-- 4) Sinkronkan tabel lookup roles (UNIQUE(name))
--    Rename bila FrontDesk belum ada, kalau sudah ada cukup hapus baris lama.
UPDATE roles
  SET name = 'FrontDesk'
  WHERE name = 'ComplianceReviewer'
    AND NOT EXISTS (SELECT 1 FROM roles r2 WHERE r2.name = 'FrontDesk');

DELETE FROM roles WHERE name = 'ComplianceReviewer';

INSERT INTO roles(name) VALUES ('FrontDesk') ON CONFLICT (name) DO NOTHING;
