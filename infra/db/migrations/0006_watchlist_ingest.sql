-- 0006_watchlist_ingest.sql (defensive)

-- 0) Pastikan tabel watchlist_entries ada (minimal shape)
CREATE TABLE IF NOT EXISTS watchlist_entries (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1) Enum list_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'watchlist_type') THEN
    CREATE TYPE watchlist_type AS ENUM ('PEP','DTTOT','PPPSPM');
  END IF;
END$$;

-- 2) Tambah kolom-kolom yang diperlukan (semua IF NOT EXISTS)
ALTER TABLE watchlist_entries
  ADD COLUMN IF NOT EXISTS list_type watchlist_type,
  ADD COLUMN IF NOT EXISTS list_source TEXT,
  ADD COLUMN IF NOT EXISTS unique_id TEXT,
  ADD COLUMN IF NOT EXISTS natural_key TEXT,

  -- nama orang (opsional) dan normalisasinya
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS name_norm TEXT,

  -- alias
  ADD COLUMN IF NOT EXISTS aliases TEXT[],
  ADD COLUMN IF NOT EXISTS aliases_concat TEXT,

  -- identitas individu dasar
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS place_of_birth TEXT,
  ADD COLUMN IF NOT EXISTS nationality TEXT,
  ADD COLUMN IF NOT EXISTS national_id_number TEXT,
  ADD COLUMN IF NOT EXISTS tax_identification_number TEXT,

  -- atribut PEP
  ADD COLUMN IF NOT EXISTS position_title TEXT,
  ADD COLUMN IF NOT EXISTS institution_name TEXT,
  ADD COLUMN IF NOT EXISTS pep_type TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,

  -- alamat
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,

  -- atribut entitas (DTTOT/PPPSPM)
  ADD COLUMN IF NOT EXISTS entity_name TEXT,
  ADD COLUMN IF NOT EXISTS registration_number TEXT,
  ADD COLUMN IF NOT EXISTS legal_form TEXT,
  ADD COLUMN IF NOT EXISTS country_of_registration TEXT,
  ADD COLUMN IF NOT EXISTS associated_individuals TEXT[],
  ADD COLUMN IF NOT EXISTS associated_entities TEXT[],
  ADD COLUMN IF NOT EXISTS relationship_type TEXT,

  -- sanksi/sumber
  ADD COLUMN IF NOT EXISTS sanction_number TEXT,
  ADD COLUMN IF NOT EXISTS inclusion_date DATE,
  ADD COLUMN IF NOT EXISTS removal_date DATE,
  ADD COLUMN IF NOT EXISTS list_updated_date DATE,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS remarks TEXT;

-- 3) Isi name_norm bila kosong (pakai COALESCE name / entity_name)
UPDATE watchlist_entries
SET name_norm = upper(regexp_replace(coalesce(name, entity_name, ''), '\s+', ' ', 'g'))
WHERE name_norm IS NULL;

-- 4) Index fuzzy & bantu
CREATE INDEX IF NOT EXISTS idx_watchlist_name_norm_trgm
  ON watchlist_entries USING gin (name_norm gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_watchlist_institution_trgm
  ON watchlist_entries USING gin (institution_name gin_trgm_ops);

-- 5) Unique indexes untuk upsert
--    a) unique_id kalau ada
CREATE UNIQUE INDEX IF NOT EXISTS ux_watchlist_unique_id
  ON watchlist_entries ((upper(unique_id)))
  WHERE unique_id IS NOT NULL;

--    b) natural_key (dibentuk di aplikasi)
CREATE UNIQUE INDEX IF NOT EXISTS ux_watchlist_natural_key
  ON watchlist_entries (natural_key);
