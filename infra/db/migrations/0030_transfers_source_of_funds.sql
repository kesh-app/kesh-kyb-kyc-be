-- 0030_transfers_source_of_funds.sql
-- Tambah kolom sumber dana (source_of_funds) dan tujuan transaksi
-- (transaction_purpose) ke tabel transfers.
-- Keduanya opsional (NULL diizinkan) agar backward-compatible.

ALTER TABLE transfers ADD COLUMN IF NOT EXISTS source_of_funds    TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS transaction_purpose TEXT;
