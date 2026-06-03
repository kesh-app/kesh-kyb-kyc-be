-- Idempoten: tambah kolom sender_application_id ke transfers
-- FK ke applications(id) untuk menyimpan referensi application KYC/KYB yang dipakai sender

ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS sender_application_id BIGINT REFERENCES applications(id);

CREATE INDEX IF NOT EXISTS idx_transfers_sender_application ON transfers(sender_application_id);
