-- 0035_individual_cdd_extended.sql
-- Extend persons table with granular KYC fields + Indonesia wilayah reference tables.
-- Data sumber: Kemendagri/BPS (seed minimal untuk test; full dataset via infra/db/seeds/regions/).

-- ── 1. New columns for persons ─────────────────────────────────────────────
ALTER TABLE persons ADD COLUMN IF NOT EXISTS alias              TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS ktp_number         VARCHAR(16);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS sim_number         VARCHAR(20);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS passport_number    VARCHAR(20);

ALTER TABLE persons ADD COLUMN IF NOT EXISTS province_code      VARCHAR(10);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS province_name      VARCHAR(100);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS city_code          VARCHAR(10);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS city_name          VARCHAR(100);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS district_code      VARCHAR(10);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS district_name      VARCHAR(100);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS village_code       VARCHAR(10);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS village_name       VARCHAR(100);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS street_address     TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS house_number       VARCHAR(50);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS rt_rw              VARCHAR(20);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS apartment_block    VARCHAR(100);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS address_landmark   TEXT;

ALTER TABLE persons ADD COLUMN IF NOT EXISTS industry_category  VARCHAR(150);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS company_name       VARCHAR(255);
ALTER TABLE persons ADD COLUMN IF NOT EXISTS company_address    TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS monthly_income_range VARCHAR(100);

-- ktp_number format constraint (15-16 digit numerik)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_persons_ktp_number_format'
  ) THEN
    ALTER TABLE persons
      ADD CONSTRAINT chk_persons_ktp_number_format
      CHECK (ktp_number IS NULL OR ktp_number ~ '^\d{15,16}$');
  END IF;
END $$;

-- ── 2. Backfill ktp_number from legacy identity_number (safe: digit-only, 15-16 chars) ─
UPDATE persons
SET ktp_number = identity_number
WHERE identity_type = 'KTP'
  AND identity_number ~ '^\d{15,16}$'
  AND ktp_number IS NULL;

-- ── 3. Wilayah reference tables ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ref_provinces (
  code   VARCHAR(10) PRIMARY KEY,
  name   VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS ref_regencies (
  code          VARCHAR(10) PRIMARY KEY,
  province_code VARCHAR(10) NOT NULL REFERENCES ref_provinces(code),
  name          VARCHAR(100) NOT NULL,
  type          VARCHAR(20)           -- KABUPATEN / KOTA
);

CREATE TABLE IF NOT EXISTS ref_districts (
  code          VARCHAR(10) PRIMARY KEY,
  regency_code  VARCHAR(10) NOT NULL REFERENCES ref_regencies(code),
  name          VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS ref_villages (
  code          VARCHAR(10) PRIMARY KEY,
  district_code VARCHAR(10) NOT NULL REFERENCES ref_districts(code),
  name          VARCHAR(100) NOT NULL,
  type          VARCHAR(20)           -- DESA / KELURAHAN
);

-- Indexes for hierarchical lookups
CREATE INDEX IF NOT EXISTS idx_ref_regencies_province  ON ref_regencies(province_code);
CREATE INDEX IF NOT EXISTS idx_ref_districts_regency   ON ref_districts(regency_code);
CREATE INDEX IF NOT EXISTS idx_ref_villages_district   ON ref_villages(district_code);

-- ── 4. Seed data — representatif untuk test + dev ──────────────────────────
-- Source: BPS Wilayah Indonesia (codes per Kemendagri 2024).
-- Full dataset: lihat infra/db/seeds/regions/README.md

INSERT INTO ref_provinces (code, name) VALUES
  ('11', 'Aceh'),
  ('12', 'Sumatera Utara'),
  ('13', 'Sumatera Barat'),
  ('14', 'Riau'),
  ('15', 'Jambi'),
  ('16', 'Sumatera Selatan'),
  ('17', 'Bengkulu'),
  ('18', 'Lampung'),
  ('19', 'Kepulauan Bangka Belitung'),
  ('21', 'Kepulauan Riau'),
  ('31', 'DKI Jakarta'),
  ('32', 'Jawa Barat'),
  ('33', 'Jawa Tengah'),
  ('34', 'DI Yogyakarta'),
  ('35', 'Jawa Timur'),
  ('36', 'Banten'),
  ('51', 'Bali'),
  ('52', 'Nusa Tenggara Barat'),
  ('53', 'Nusa Tenggara Timur'),
  ('61', 'Kalimantan Barat'),
  ('62', 'Kalimantan Tengah'),
  ('63', 'Kalimantan Selatan'),
  ('64', 'Kalimantan Timur'),
  ('65', 'Kalimantan Utara'),
  ('71', 'Sulawesi Utara'),
  ('72', 'Sulawesi Tengah'),
  ('73', 'Sulawesi Selatan'),
  ('74', 'Sulawesi Tenggara'),
  ('75', 'Gorontalo'),
  ('76', 'Sulawesi Barat'),
  ('81', 'Maluku'),
  ('82', 'Maluku Utara'),
  ('91', 'Papua Barat'),
  ('94', 'Papua')
ON CONFLICT (code) DO NOTHING;

INSERT INTO ref_regencies (code, province_code, name, type) VALUES
  -- DKI Jakarta (31)
  ('3171', '31', 'Kota Jakarta Pusat', 'KOTA'),
  ('3172', '31', 'Kota Jakarta Utara', 'KOTA'),
  ('3173', '31', 'Kota Jakarta Barat', 'KOTA'),
  ('3174', '31', 'Kota Jakarta Selatan', 'KOTA'),
  ('3175', '31', 'Kota Jakarta Timur', 'KOTA'),
  ('3101', '31', 'Kabupaten Kepulauan Seribu', 'KABUPATEN'),
  -- Jawa Barat (32)
  ('3201', '32', 'Kabupaten Bogor', 'KABUPATEN'),
  ('3202', '32', 'Kabupaten Sukabumi', 'KABUPATEN'),
  ('3273', '32', 'Kota Bandung', 'KOTA'),
  ('3276', '32', 'Kota Depok', 'KOTA'),
  ('3277', '32', 'Kota Bekasi', 'KOTA'),
  -- Jawa Tengah (33)
  ('3374', '33', 'Kota Semarang', 'KOTA'),
  -- Jawa Timur (35)
  ('3578', '35', 'Kota Surabaya', 'KOTA'),
  -- Banten (36)
  ('3671', '36', 'Kota Tangerang', 'KOTA')
ON CONFLICT (code) DO NOTHING;

INSERT INTO ref_districts (code, regency_code, name) VALUES
  -- Jakarta Pusat (3171)
  ('3171010', '3171', 'Gambir'),
  ('3171020', '3171', 'Sawah Besar'),
  ('3171030', '3171', 'Kemayoran'),
  ('3171040', '3171', 'Senen'),
  ('3171050', '3171', 'Cempaka Putih'),
  ('3171060', '3171', 'Menteng'),
  ('3171070', '3171', 'Tanah Abang'),
  ('3171080', '3171', 'Johar Baru'),
  -- Jakarta Timur (3175)
  ('3175010', '3175', 'Pasar Rebo'),
  ('3175020', '3175', 'Ciracas'),
  -- Kota Bandung (3273)
  ('3273010', '3273', 'Astana Anyar'),
  ('3273020', '3273', 'Bojongloa Kaler'),
  ('3273030', '3273', 'Babakan Ciparay')
ON CONFLICT (code) DO NOTHING;

INSERT INTO ref_villages (code, district_code, name, type) VALUES
  -- Gambir, Jakarta Pusat (3171010)
  ('3171010001', '3171010', 'Gambir', 'KELURAHAN'),
  ('3171010002', '3171010', 'Cideng', 'KELURAHAN'),
  ('3171010003', '3171010', 'Petojo Selatan', 'KELURAHAN'),
  ('3171010004', '3171010', 'Petojo Utara', 'KELURAHAN'),
  ('3171010005', '3171010', 'Kebon Kelapa', 'KELURAHAN'),
  ('3171010006', '3171010', 'Duri Pulo', 'KELURAHAN'),
  -- Sawah Besar, Jakarta Pusat (3171020)
  ('3171020001', '3171020', 'Pasar Baru', 'KELURAHAN'),
  ('3171020002', '3171020', 'Karang Anyar', 'KELURAHAN'),
  -- Astana Anyar, Bandung (3273010)
  ('3273010001', '3273010', 'Karang Anyar', 'KELURAHAN'),
  ('3273010002', '3273010', 'Pelindung Hewan', 'KELURAHAN'),
  ('3273010003', '3273010', 'Nyengseret', 'KELURAHAN')
ON CONFLICT (code) DO NOTHING;
