-- 0061_business_deed_split.sql
-- Pecah satu field akta menjadi dua pada Informasi Identitas Badan Usaha:
--   1. No. Akta Pendirian          → deed_establishment_number     (wajib bila PT)
--   2. No. Akta Perubahan Terakhir → deed_latest_amendment_number  (opsional)
--
-- deed_number (label lama "No Akta Pendirian / Akta Perubahan") DIPERTAHANKAN
-- sebagai kolom fisik untuk kompatibilitas mundur — masih dibaca FE/report lama
-- dan tetap diisi service dengan nilai yang sama dengan deed_establishment_number.

ALTER TABLE business_entities
  ADD COLUMN IF NOT EXISTS deed_establishment_number    TEXT;

ALTER TABLE business_entities
  ADD COLUMN IF NOT EXISTS deed_latest_amendment_number TEXT;

-- Backfill: data lama hanya punya satu nomor akta, dan itu adalah nomor
-- pendirian. Akta perubahan dibiarkan NULL — tidak pernah wajib, dan menebak
-- nilainya dari kolom gabungan lama akan salah.
UPDATE business_entities
   SET deed_establishment_number = deed_number
 WHERE deed_establishment_number IS NULL
   AND deed_number IS NOT NULL;

COMMENT ON COLUMN business_entities.deed_number IS
  'DEPRECATED — kolom gabungan lama. Di-mirror dari deed_establishment_number, dipertahankan untuk klien lama.';
COMMENT ON COLUMN business_entities.deed_establishment_number IS
  'No. Akta Pendirian. Wajib untuk badan usaha PT.';
COMMENT ON COLUMN business_entities.deed_latest_amendment_number IS
  'No. Akta Perubahan Terakhir. Selalu opsional.';
