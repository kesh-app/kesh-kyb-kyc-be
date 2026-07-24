-- 0052_transfer_relationship_and_bulk.sql
-- 1) Field wajib "Hubungan dengan Pengirim" pada pencatatan transfer.
--    Kolom dibuat NULLable di DB agar baris transfer lama tidak melanggar constraint;
--    kewajiban diisi ditegakkan di layer DTO/service (create/update/submit).
-- 2) Bulk transfer: tabel transfer_batches untuk traceability + transfers.batch_id.
--    Setiap item bulk tetap menjadi baris transfer normal (DRAFT) sehingga alur
--    approval yang ada tetap berlaku per transfer.
--
-- Idempotent: aman dijalankan ulang.

ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS beneficiary_relationship_to_sender VARCHAR(150);

CREATE TABLE IF NOT EXISTS transfer_batches (
  id                     BIGSERIAL PRIMARY KEY,
  batch_no               VARCHAR(40) NOT NULL UNIQUE,
  created_by             BIGINT REFERENCES users(id),
  sender_application_id  BIGINT REFERENCES applications(id),
  total_count            INT NOT NULL DEFAULT 0,
  total_amount           NUMERIC(20,2) NOT NULL DEFAULT 0,
  status                 VARCHAR(20) NOT NULL DEFAULT 'CREATED'
                           CHECK (status IN ('CREATED','CANCELLED')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS batch_id BIGINT REFERENCES transfer_batches(id);

CREATE INDEX IF NOT EXISTS idx_transfers_batch_id ON transfers(batch_id);
CREATE INDEX IF NOT EXISTS idx_transfer_batches_created_by ON transfer_batches(created_by);
CREATE INDEX IF NOT EXISTS idx_transfer_batches_sender ON transfer_batches(sender_application_id);
