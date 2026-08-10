-- 0063_ref_wilayah_timestamps.sql
-- Kolom audit untuk tabel referensi wilayah (ref_provinces/regencies/districts/
-- villages). Dipakai scripts/import-wilayah.cjs supaya terlihat kapan sebuah
-- baris wilayah terakhir diperbarui dari dataset sumber.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ref_provinces','ref_regencies','ref_districts','ref_villages'] LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()', t);
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()', t);
  END LOOP;
END $$;
