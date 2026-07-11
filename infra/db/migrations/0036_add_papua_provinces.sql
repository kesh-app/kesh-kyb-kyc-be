-- 0036_add_papua_provinces.sql
-- Tambah 4 provinsi pemekaran Papua (UU No. 14-16 dan 29 Tahun 2022).
-- Kode mengikuti Kemendagri/BPS 2022.
-- Total provinsi Indonesia: 38 (sebelumnya 34 di seed 0035).

INSERT INTO ref_provinces (code, name) VALUES
  ('92', 'Papua Barat Daya'),   -- UU No. 29/2022, pemekaran dari Papua Barat (91)
  ('95', 'Papua Selatan'),      -- UU No. 14/2022, pemekaran dari Papua (94)
  ('96', 'Papua Tengah'),       -- UU No. 15/2022, pemekaran dari Papua (94)
  ('97', 'Papua Pegunungan')    -- UU No. 16/2022, pemekaran dari Papua (94)
ON CONFLICT (code) DO NOTHING;

-- Catatan: data kab/kota/kecamatan/kelurahan untuk 4 provinsi baru ini
-- belum di-seed di level ini (current dev seed is partial below province level).
-- Production must import full dataset under infra/db/seeds/regions/
-- menggunakan dataset BPS/Kemendagri terbaru.
