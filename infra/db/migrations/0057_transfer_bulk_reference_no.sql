-- 0057_transfer_bulk_reference_no.sql
-- Nomor referensi bulk transfer level batch (input finance/partner), terpisah dari
-- reference_no tiap baris transfer.
--   batch_no          = nomor batch internal KESH (auto-generate)
--   bulk_reference_no = nomor referensi dari user/finance/partner untuk satu bulk
--
-- Kolom NULLable agar baris batch lama tidak melanggar constraint (tidak di-backfill
-- dengan data palsu); kewajiban diisi ditegakkan di DTO/service untuk create baru.
-- Unique di-scope per sender: satu sender tidak boleh punya 2 bulk dengan referensi sama,
-- sender lain boleh memakai nomor yang sama.
--
-- Idempotent: aman dijalankan ulang.

ALTER TABLE transfer_batches
  ADD COLUMN IF NOT EXISTS bulk_reference_no VARCHAR(150);

CREATE UNIQUE INDEX IF NOT EXISTS uq_transfer_batches_sender_bulk_ref
  ON transfer_batches(sender_application_id, bulk_reference_no)
  WHERE bulk_reference_no IS NOT NULL;
