-- 0028_document_upload_status.sql
-- Dokumen KYC/KYB TIDAK punya workflow review/approval terpisah.
-- Status dokumen hanya menandakan hasil UPLOAD file ke storage:
--   UPLOADED : file berhasil tersimpan di storage (status sukses baru)
--   FAILED   : opsional, jika ada use case gagal tersimpan
-- Status lama (PENDING/VERIFIED/REJECTED) tetap diizinkan constraint untuk
-- kompatibilitas data legacy, TAPI tidak dipakai untuk upload sukses baru.
-- PENDING TIDAK lagi berarti "menunggu review".

-- 1. Redefinisi CHECK constraint agar menerima UPLOADED/FAILED.
--    Cari nama constraint status aktual (inline column check biasanya
--    bernama documents_status_check) lalu drop, agar tahan beda nama.
DO $$
DECLARE
  c_name TEXT;
BEGIN
  SELECT con.conname INTO c_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'documents'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%';

  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE documents DROP CONSTRAINT %I', c_name);
  END IF;
END;
$$;

ALTER TABLE documents
  ADD CONSTRAINT documents_status_check
  CHECK (status IN ('UPLOADED','FAILED','PENDING','VERIFIED','REJECTED'));

-- 2. Dokumen baru default UPLOADED (record dibuat hanya setelah upload sukses).
ALTER TABLE documents ALTER COLUMN status SET DEFAULT 'UPLOADED';

-- 3. Backfill: PENDING legacy yang file-nya benar-benar ada -> UPLOADED.
--    (file_uri NOT NULL di schema, jadi ini aman: tidak menyentuh record
--     yang tidak punya file.)
UPDATE documents
   SET status = 'UPLOADED'
 WHERE status = 'PENDING'
   AND file_uri IS NOT NULL;
