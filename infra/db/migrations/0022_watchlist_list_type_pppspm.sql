-- 0022: list_type CHECK menerima PPPSPM (selain PEP, DTTOT).
--
-- Latar: UploadWatchlistDto (@IsIn) dan IngestRow union sudah mengizinkan PPPSPM,
-- tetapi CHECK lama dari 0003 hanya ('PEP','DTTOT') sehingga SETIAP upload PPPSPM
-- gagal di DB dan tertelan ke errorMessage (silent failure — 0 row tersimpan).
--
-- Perbedaan penting (rule 4):
--   * list_type      = tipe upload UTAMA, selalu salah satu PEP / DTTOT / PPPSPM
--                      (divalidasi DTO). TIDAK menerima OTHER.
--   * watchlist_type = klasifikasi PER-BARIS v3 (kolom terpisah) yang boleh OTHER
--                      sebagai fallback. Constraint di sini tidak menyentuhnya.
--
-- Aman untuk data existing: nilai yang ada hanya PEP/DTTOT, lolos constraint baru.
ALTER TABLE watchlist_entries
  DROP CONSTRAINT IF EXISTS watchlist_entries_list_type_check;

ALTER TABLE watchlist_entries
  ADD CONSTRAINT watchlist_entries_list_type_check
  CHECK (list_type IN ('PEP', 'DTTOT', 'PPPSPM'));
