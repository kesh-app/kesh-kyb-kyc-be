-- 0062_public_uuid_and_kyb_address.sql
--
-- A. Identifier publik UUIDv4 (public_id) untuk entitas yang tampil di UI.
-- B. Alamat Kedudukan KYB diperluas sampai kecamatan & kelurahan/desa.
--
-- CATATAN PENTING soal A:
-- Ini SENGAJA bukan migrasi PK/FK. Kolom `id` numerik dan SEMUA kolom FK yang
-- menunjuk ke sana tidak disentuh sama sekali. `public_id` hanya identifier
-- tambahan yang aman dipakai di URL/response. Konversi PK/FK ke UUID adalah
-- epik migrasi tersendiri (ratusan FK + semua route numerik) dan tidak boleh
-- dicampur ke sini.

-- gen_random_uuid() sudah built-in sejak PostgreSQL 13; extension ini hanya
-- jaring pengaman untuk target deploy yang masih PG12 ke bawah.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── A. public_id UUIDv4 ─────────────────────────────────────────────────────
-- Loop, bukan 14 blok copy-paste: langkahnya identik untuk tiap tabel dan
-- urutannya penting (isi dulu baru NOT NULL, supaya baris lama tidak menabrak
-- constraint). Idempotent — aman dijalankan ulang setelah run yang gagal
-- separuh jalan.
DO $$
DECLARE
  t text;
  targets text[] := ARRAY[
    'applications',
    'persons',
    'business_entities',
    'documents',
    'business_parties',
    'transfers',
    'transfer_batches',
    'complaints',
    'statement_refunds',
    'monitoring_cases',
    'generated_reports',
    'application_data_reviews',
    'watchlist_entries',
    'users'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'lewati %: tabel tidak ada', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS public_id UUID', t);
    -- Backfill baris lama. gen_random_uuid() volatile → dievaluasi per baris.
    EXECUTE format('UPDATE %I SET public_id = gen_random_uuid() WHERE public_id IS NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN public_id SET DEFAULT gen_random_uuid()', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN public_id SET NOT NULL', t);
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_%s_public_id ON %I (public_id)', t, t);
  END LOOP;
END $$;

-- ── B. Alamat Kedudukan KYB: kecamatan & kelurahan/desa ─────────────────────
-- Mengikuti konvensi kolom yang sudah dipakai tabel ini (migrasi 0047):
-- business_<level>_code / business_<level>_name, dengan lebar yang sama seperti
-- pasangan provinsi/kota. Nullable — baris KYB lama tidak punya nilai ini.
ALTER TABLE business_entities
  ADD COLUMN IF NOT EXISTS business_district_code VARCHAR(10),
  ADD COLUMN IF NOT EXISTS business_district_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS business_village_code  VARCHAR(10),
  ADD COLUMN IF NOT EXISTS business_village_name  VARCHAR(100);

COMMENT ON COLUMN business_entities.business_district_code IS 'Kecamatan — kode ref_districts';
COMMENT ON COLUMN business_entities.business_district_name IS 'Kecamatan — nama kanonik dari ref_districts';
COMMENT ON COLUMN business_entities.business_village_code  IS 'Kelurahan/Desa — kode ref_villages';
COMMENT ON COLUMN business_entities.business_village_name  IS 'Kelurahan/Desa — nama kanonik dari ref_villages';
