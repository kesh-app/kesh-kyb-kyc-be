-- 0026_fix_non_bo_cif.sql
-- business_parties.cif_relationship_type tidak boleh default 'BO' untuk semua role.
-- Hanya role = BO yang mendapat cif_relationship_type.
-- Non-BO parties (DIRECTOR, COMMISSIONER, MANAGER, AUTHORIZED_REP) → NULL.

-- Hapus DEFAULT dan NOT NULL agar nullable
ALTER TABLE business_parties
  ALTER COLUMN cif_relationship_type DROP DEFAULT,
  ALTER COLUMN cif_relationship_type DROP NOT NULL;

-- Bersihkan non-BO parties yang salah dapat 'BO' dari DEFAULT migrasi 0025
UPDATE business_parties
SET    cif_relationship_type = NULL
WHERE  role <> 'BO';
