-- 0064_wilayah_kemendagri_codes_cleanup.sql
--
-- Membersihkan baris wilayah lama yang memakai SISTEM KODE BERBEDA dari dataset
-- resmi Kepmendagri No. 300.2.2-2138 Tahun 2025 yang baru di-import.
--
-- MASALAHNYA:
-- Seed lama (migrasi 0035/0037) memakai kode gaya BPS untuk kecamatan/desa —
-- kecamatan 7 digit (regency 4 + urut 3), mis. Enggal = '1871170'. Kepmendagri
-- memakai 6 digit (prov 2 + kab 2 + kec 2), mis. Enggal = '187117'. Keduanya
-- bukan varian penulisan: angkanya memang beda, dan import mencatat
-- "7285 inserted, 0 updated" — nol tumpang tindih.
--
-- Akibatnya satu kecamatan yang sama muncul DUA KALI di cascade alamat FE
-- (36 dari 38 kecamatan lama persis menduplikasi nama kecamatan resmi).
--
-- YANG DILAKUKAN:
--   1. Kode wilayah yang TERSIMPAN di persons/business_entities dipetakan dari
--      kode lama ke kode resmi berdasarkan kecocokan nama pada induk yang sama.
--      Tidak ada data yang dibuang — kolom *_name tetap sama persis, hanya
--      *_code yang dibetulkan.
--   2. Baris ref_* lama (yang tidak ada di dataset resmi) dihapus.
--
-- CATATAN: ini penghapusan TERARAH pada 80 baris yang terbukti bukan kode resmi,
-- bukan `--prune` menyeluruh dari importer. Importer sendiri tetap tidak pernah
-- menghapus apa pun tanpa flag eksplisit.

BEGIN;

-- ── Peta kode lama → kode resmi ────────────────────────────────────────────
-- Pembeda struktural, sah karena dataset resmi baru saja di-import utuh:
--   kecamatan resmi  = length(code) 6   |  kecamatan lama = length(code) 7
--   kab/kota resmi   = punya kecamatan 6-digit
--   provinsi resmi   = punya kab/kota resmi
CREATE TEMP TABLE map_district ON COMMIT DROP AS
SELECT d_old.code AS old_code, d_new.code AS new_code
  FROM ref_districts d_old
  JOIN ref_districts d_new
    ON length(d_new.code) = 6
   AND d_new.regency_code = d_old.regency_code
   AND d_new.name = d_old.name
 WHERE length(d_old.code) = 7;

CREATE TEMP TABLE map_village ON COMMIT DROP AS
SELECT v_old.code AS old_code, v_new.code AS new_code
  FROM ref_villages v_old
  JOIN map_district m ON m.old_code = v_old.district_code
  JOIN ref_villages v_new
    ON v_new.district_code = m.new_code
   AND v_new.name = v_old.name;

CREATE TEMP TABLE map_regency ON COMMIT DROP AS
SELECT r_old.code AS old_code, r_new.code AS new_code
  FROM ref_regencies r_old
  JOIN ref_regencies r_new
    ON r_new.name = r_old.name
   AND r_new.code <> r_old.code
   AND EXISTS (SELECT 1 FROM ref_districts d
                WHERE d.regency_code = r_new.code AND length(d.code) = 6)
 WHERE NOT EXISTS (SELECT 1 FROM ref_districts d
                    WHERE d.regency_code = r_old.code AND length(d.code) = 6);

CREATE TEMP TABLE map_province ON COMMIT DROP AS
SELECT p_old.code AS old_code, p_new.code AS new_code
  FROM ref_provinces p_old
  JOIN ref_provinces p_new
    ON p_new.name = p_old.name
   AND p_new.code <> p_old.code
   AND EXISTS (SELECT 1 FROM ref_regencies r
                WHERE r.province_code = p_new.code
                  AND EXISTS (SELECT 1 FROM ref_districts d
                               WHERE d.regency_code = r.code AND length(d.code) = 6))
 WHERE NOT EXISTS (SELECT 1 FROM ref_regencies r
                    WHERE r.province_code = p_old.code
                      AND EXISTS (SELECT 1 FROM ref_districts d
                                   WHERE d.regency_code = r.code AND length(d.code) = 6));

-- ── 1. Betulkan kode yang sudah tersimpan ─────────────────────────────────
UPDATE persons p SET province_code = m.new_code
  FROM map_province m WHERE p.province_code = m.old_code;
UPDATE persons p SET city_code = m.new_code
  FROM map_regency m WHERE p.city_code = m.old_code;
UPDATE persons p SET district_code = m.new_code
  FROM map_district m WHERE p.district_code = m.old_code;
UPDATE persons p SET village_code = m.new_code
  FROM map_village m WHERE p.village_code = m.old_code;

UPDATE business_entities b SET business_province_code = m.new_code
  FROM map_province m WHERE b.business_province_code = m.old_code;
UPDATE business_entities b SET business_city_code = m.new_code
  FROM map_regency m WHERE b.business_city_code = m.old_code;
UPDATE business_entities b SET business_district_code = m.new_code
  FROM map_district m WHERE b.business_district_code = m.old_code;
UPDATE business_entities b SET business_village_code = m.new_code
  FROM map_village m WHERE b.business_village_code = m.old_code;

-- ── 2. Buang baris referensi non-resmi ────────────────────────────────────
-- Anak dulu, supaya tidak ada baris yang sempat menggantung di tengah jalan.
DELETE FROM ref_villages v
 WHERE EXISTS (SELECT 1 FROM ref_districts d
                WHERE d.code = v.district_code AND length(d.code) = 7);
DELETE FROM ref_districts WHERE length(code) = 7;
DELETE FROM ref_regencies r
 WHERE NOT EXISTS (SELECT 1 FROM ref_districts d WHERE d.regency_code = r.code);
DELETE FROM ref_provinces p
 WHERE NOT EXISTS (SELECT 1 FROM ref_regencies r WHERE r.province_code = p.code);

COMMIT;
