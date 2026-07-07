-- 0024_cif_no.sql
-- Tambahkan CIF (Customer Information File) number ke persons dan business_entities.
-- Format:
--   Individual : KSH-I-<NIK_LAST6>-<SEQ5>
--   Business   : KSH-B-<NIB_OR_NPWP_LAST6>-<SEQ5>

CREATE SEQUENCE IF NOT EXISTS cif_individual_seq START 1;
CREATE SEQUENCE IF NOT EXISTS cif_business_seq START 1;

ALTER TABLE persons          ADD COLUMN IF NOT EXISTS cif_no VARCHAR(32) UNIQUE;
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS cif_no VARCHAR(32) UNIQUE;

-- Backfill: persons yang belum punya CIF
DO $$
DECLARE
  r        RECORD;
  digits   TEXT;
  last6    TEXT;
  seq_val  BIGINT;
  cif      TEXT;
BEGIN
  FOR r IN SELECT id, identity_number FROM persons WHERE cif_no IS NULL ORDER BY id LOOP
    digits := regexp_replace(COALESCE(r.identity_number, ''), '[^0-9]', '', 'g');
    IF digits = '' THEN
      last6 := '000000';
    ELSIF length(digits) < 6 THEN
      last6 := lpad(digits, 6, '0');
    ELSE
      last6 := right(digits, 6);
    END IF;
    seq_val := nextval('cif_individual_seq');
    cif := 'KSH-I-' || last6 || '-' || lpad(seq_val::TEXT, 5, '0');
    UPDATE persons SET cif_no = cif WHERE id = r.id;
  END LOOP;
END;
$$;

-- Backfill: business_entities yang belum punya CIF
DO $$
DECLARE
  r        RECORD;
  src      TEXT;
  digits   TEXT;
  last6    TEXT;
  seq_val  BIGINT;
  cif      TEXT;
BEGIN
  FOR r IN SELECT id, nib, npwp FROM business_entities WHERE cif_no IS NULL ORDER BY id LOOP
    src    := COALESCE(r.nib, r.npwp, '');
    digits := regexp_replace(src, '[^0-9]', '', 'g');
    IF digits = '' THEN
      last6 := '000000';
    ELSIF length(digits) < 6 THEN
      last6 := lpad(digits, 6, '0');
    ELSE
      last6 := right(digits, 6);
    END IF;
    seq_val := nextval('cif_business_seq');
    cif := 'KSH-B-' || last6 || '-' || lpad(seq_val::TEXT, 5, '0');
    UPDATE business_entities SET cif_no = cif WHERE id = r.id;
  END LOOP;
END;
$$;
