-- 0029_cif_no_remove_dashes.sql
-- Ubah format CIF: hapus semua tanda "-" dari CIF tersimpan.
-- Old: KSH-I-<LAST6>-<SEQ5>  →  New: KSHI<LAST6><SEQ5>
-- Old: KSH-B-<LAST6>-<SEQ5>  →  New: KSHB<LAST6><SEQ5>
-- Generator di applications.service.ts sudah diperbarui untuk format baru.
-- Sequence tidak berubah — hanya format string.

UPDATE persons           SET cif_no = replace(cif_no, '-', '') WHERE cif_no IS NOT NULL;
UPDATE business_entities SET cif_no = replace(cif_no, '-', '') WHERE cif_no IS NOT NULL;
UPDATE business_parties  SET cif_no = replace(cif_no, '-', '') WHERE cif_no IS NOT NULL;
UPDATE monitoring_cases  SET cif_no = replace(cif_no, '-', '') WHERE cif_no IS NOT NULL;
