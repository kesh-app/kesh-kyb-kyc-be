-- 0025_cif_relationship.sql
-- Tambahkan cif_relationship_type ke persons dan business_parties.
-- Tambahkan cif_no ke business_parties (khususnya untuk BO).
-- Backfill BO business_parties.cif_no dari persons atau generate baru.

-- 1. persons.cif_relationship_type
ALTER TABLE persons
  ADD COLUMN IF NOT EXISTS cif_relationship_type VARCHAR(20)
    NOT NULL DEFAULT 'OUR_CUSTOMER'
    CHECK (cif_relationship_type IN ('OUR_CUSTOMER','BO','WIC'));

-- 2. business_parties: cif_no + cif_relationship_type
ALTER TABLE business_parties
  ADD COLUMN IF NOT EXISTS cif_no VARCHAR(32),
  ADD COLUMN IF NOT EXISTS cif_relationship_type VARCHAR(20)
    NOT NULL DEFAULT 'BO'
    CHECK (cif_relationship_type IN ('OUR_CUSTOMER','BO','WIC'));

CREATE INDEX IF NOT EXISTS idx_business_parties_cif_no ON business_parties(cif_no);

-- 3. Backfill business_parties BO: cif_no dari persons atau generate baru
DO $$
DECLARE
  r          RECORD;
  found_cif  TEXT;
  digits     TEXT;
  last6      TEXT;
  seq_val    BIGINT;
BEGIN
  FOR r IN
    SELECT bp.id, p.identity_number, p.cif_no AS person_cif
    FROM   business_parties bp
    JOIN   persons p ON p.id = bp.person_id
    WHERE  bp.role = 'BO' AND bp.cif_no IS NULL
    ORDER  BY bp.id
  LOOP
    -- Prioritas 1: cif_no sudah ada di persons (OUR_CUSTOMER sebelumnya)
    found_cif := r.person_cif;

    -- Prioritas 2: BO lain dengan identity_number sama sudah punya cif_no
    IF found_cif IS NULL THEN
      SELECT bp2.cif_no INTO found_cif
      FROM   business_parties bp2
      JOIN   persons p2 ON p2.id = bp2.person_id
      WHERE  regexp_replace(COALESCE(p2.identity_number,''), '[^0-9]', '', 'g')
               = regexp_replace(COALESCE(r.identity_number,''), '[^0-9]', '', 'g')
        AND  bp2.cif_no IS NOT NULL
        AND  COALESCE(r.identity_number,'') != ''
      LIMIT  1;
    END IF;

    IF found_cif IS NOT NULL THEN
      UPDATE business_parties SET cif_no = found_cif WHERE id = r.id;
    ELSE
      -- Generate CIF baru
      digits := regexp_replace(COALESCE(r.identity_number, ''), '[^0-9]', '', 'g');
      IF digits = '' THEN
        last6 := '000000';
      ELSIF length(digits) < 6 THEN
        last6 := lpad(digits, 6, '0');
      ELSE
        last6 := right(digits, 6);
      END IF;
      seq_val := nextval('cif_individual_seq');
      found_cif := 'KSH-I-' || last6 || '-' || lpad(seq_val::TEXT, 5, '0');
      UPDATE business_parties SET cif_no = found_cif WHERE id = r.id;
    END IF;

    -- Sync ke persons.cif_no jika belum ada (BO tanpa OUR_CUSTOMER application)
    UPDATE persons
    SET    cif_no = COALESCE(cif_no, found_cif)
    WHERE  id = (SELECT person_id FROM business_parties WHERE id = r.id);
  END LOOP;
END;
$$;
