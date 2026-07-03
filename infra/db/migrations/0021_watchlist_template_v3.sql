-- Watchlist Template v3: kolom opsional tambahan untuk audit & traceability
-- (kebutuhan DTTOT PPATK & PEP). Semua nullable, idempotent via IF NOT EXISTS.
--
-- Catatan: place_of_birth, position_title, institution_name, address sudah ada
-- (bertipe TEXT) dari migrasi sebelumnya — baris IF NOT EXISTS-nya menjadi no-op
-- dan TIDAK mengubah tipe kolom lama (tidak ada risiko break data existing).
-- Kolom benar-benar baru: watchlist_type, subject_type, raw_date_of_birth, description.
ALTER TABLE watchlist_entries
  ADD COLUMN IF NOT EXISTS watchlist_type    VARCHAR(32),
  ADD COLUMN IF NOT EXISTS subject_type      VARCHAR(32),
  ADD COLUMN IF NOT EXISTS raw_date_of_birth TEXT,
  ADD COLUMN IF NOT EXISTS place_of_birth    VARCHAR(150),
  ADD COLUMN IF NOT EXISTS position_title    VARCHAR(150),
  ADD COLUMN IF NOT EXISTS institution_name  VARCHAR(200),
  ADD COLUMN IF NOT EXISTS address           TEXT,
  ADD COLUMN IF NOT EXISTS description       TEXT;
