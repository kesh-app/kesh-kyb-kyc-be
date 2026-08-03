-- 0059_watchlist_duplicate_guard.sql
-- Duplicate guard untuk upload watchlist.
--
-- Sebelumnya unique_id unik SECARA GLOBAL, sehingga satu Unique_ID tidak bisa
-- dipakai di dua jenis list. Kenyataannya penomoran sanksi bersifat per-list,
-- jadi kunci duplikat yang benar adalah (list_type, unique_id).
--
-- sanction_number SENGAJA tidak diberi unique index: data sanksi asli bisa
-- mengulang nomor rujukan yang sama pada beberapa listing. Dedup memakai kolom
-- ini dilakukan di service (upsert), index di bawah hanya untuk kecepatan lookup.

-- 1) Kunci duplikat utama: list_type + unique_id
CREATE UNIQUE INDEX IF NOT EXISTS ux_watchlist_list_type_unique_id
  ON watchlist_entries (list_type, (upper(unique_id)))
  WHERE unique_id IS NOT NULL;

DROP INDEX IF EXISTS ux_watchlist_unique_id;

-- 2) Kunci duplikat sekunder: list_type + sanction_number (lookup only)
CREATE INDEX IF NOT EXISTS idx_watchlist_list_type_sanction_number
  ON watchlist_entries (list_type, (upper(sanction_number)))
  WHERE sanction_number IS NOT NULL;

-- 3) Fallback peringatan lunak: list_type + nama ternormalisasi
--    Tidak pernah dipakai untuk dedup otomatis — nama sama bisa milik orang
--    yang berbeda. Index ini hanya mempercepat pencarian kandidat warning.
CREATE INDEX IF NOT EXISTS idx_watchlist_list_type_name_norm
  ON watchlist_entries (list_type, name_norm);

-- 4) natural_key = sha1(list_type|list_source|nama|tanggal_lahir) diturunkan
--    dari kunci unik menjadi index biasa.
--    Sebagai kunci dedup ia MENGGABUNGKAN dua orang berbeda yang kebetulan
--    punya nama + tanggal lahir sama pada list & sumber yang sama — persis
--    kasus yang harus jadi warning, bukan merge diam-diam. Perannya sebagai
--    "kunci baris yang sama diupload ulang" kini dipegang unique_id
--    auto-generate yang deterministik (KESH-WL-AUTO-*). Kolomnya tetap ditulis
--    untuk audit/traceability.
DROP INDEX IF EXISTS ux_watchlist_natural_key;

CREATE INDEX IF NOT EXISTS idx_watchlist_natural_key
  ON watchlist_entries (natural_key);
