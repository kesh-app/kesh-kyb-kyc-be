-- 0053_application_first_submitted_at.sql
-- Base date untuk perhitungan periode Pengkinian Data (periodic customer data review).
-- first_submitted_at diisi hanya sekali (saat submit pertama) dan TIDAK di-reset saat
-- resubmit/revisi. Backfill dari submitted_at untuk baris yang sudah ada.
--
-- Idempotent: aman dijalankan ulang.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS first_submitted_at TIMESTAMPTZ;

UPDATE applications
   SET first_submitted_at = submitted_at
 WHERE first_submitted_at IS NULL
   AND submitted_at IS NOT NULL;
