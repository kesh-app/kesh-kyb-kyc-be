-- 0004_pbi_10_2024_cdd.sql
ALTER TABLE persons ADD COLUMN IF NOT EXISTS identity_type    TEXT CHECK (identity_type IN ('KTP','SIM','PASPOR','LAINNYA'));
ALTER TABLE persons ADD COLUMN IF NOT EXISTS identity_number  TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS address_identity TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS address_residential TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS occupation       TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS signature_uri    TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ux_persons_ktp_identity') THEN
    EXECUTE 'CREATE UNIQUE INDEX ux_persons_ktp_identity ON persons (identity_number) WHERE identity_type = ''KTP''';
  END IF;
END $$;

ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS legal_form               TEXT;
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS incorporation_place      TEXT;
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS business_license_number  TEXT;
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS business_activity        TEXT;
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS phone                    TEXT;

CREATE TABLE IF NOT EXISTS authorized_representatives (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT REFERENCES business_entities(id) ON DELETE CASCADE,
  person_id BIGINT REFERENCES persons(id) ON DELETE CASCADE,
  authorization_doc_number TEXT,
  authorization_doc_uri TEXT,
  valid_from DATE,
  valid_to DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_authrep_business ON authorized_representatives(business_id);

CREATE OR REPLACE FUNCTION enforce_cdd_minimum_before_submit() RETURNS trigger AS $$
DECLARE
  cnt INT;
  cnt_mgmt INT;
  cnt_bo INT;
  cnt_authrep INT;
BEGIN
  IF NEW.status = 'SUBMITTED' AND OLD.status <> 'SUBMITTED' THEN
    IF NEW.type = 'INDIVIDUAL' THEN
      PERFORM 1 FROM persons p
       WHERE p.id = NEW.person_id
         AND p.full_name IS NOT NULL AND length(trim(p.full_name)) > 0
         AND p.identity_type IS NOT NULL
         AND p.identity_number IS NOT NULL AND length(trim(p.identity_number)) > 0
         AND p.address_identity IS NOT NULL AND length(trim(p.address_identity)) > 0
         AND p.pob IS NOT NULL
         AND p.dob IS NOT NULL
         AND p.nationality IS NOT NULL
         AND p.phone IS NOT NULL
         AND p.occupation IS NOT NULL
         AND p.gender IS NOT NULL
         AND p.signature_uri IS NOT NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'KYC CDD minimum (INDIVIDUAL) belum lengkap';
      END IF;

      SELECT COUNT(*) INTO cnt FROM documents d
       WHERE d.application_id = NEW.id AND d.doc_type IN ('KTP','SIM','PASPOR');
      IF cnt = 0 THEN
        RAISE EXCEPTION 'Dokumen identitas (KTP/SIM/PASPOR) wajib diunggah';
      END IF;

    ELSE
      PERFORM 1 FROM business_entities b
       WHERE b.id = NEW.business_id
         AND b.legal_name IS NOT NULL AND length(trim(b.legal_name)) > 0
         AND b.legal_form IS NOT NULL
         AND b.incorporation_date IS NOT NULL
         AND b.incorporation_place IS NOT NULL
         AND b.nib IS NOT NULL AND length(trim(b.nib)) > 0
         AND b.npwp IS NOT NULL AND length(trim(b.npwp)) > 0
         AND b.business_license_number IS NOT NULL
         AND b.address_line IS NOT NULL AND length(trim(b.address_line)) > 0
         AND b.business_activity IS NOT NULL
         AND b.phone IS NOT NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'KYB CDD minimum (BUSINESS) belum lengkap';
      END IF;

      -- ✅ UBAH RULE: cukup salah satu saja (pengurus ATAU BO ATAU authorized rep)
      SELECT COUNT(*) INTO cnt_mgmt
        FROM business_roles
       WHERE business_id = NEW.business_id
         AND role IN ('DIRECTOR','COMMISSIONER');

      SELECT COUNT(*) INTO cnt_bo
        FROM business_roles
       WHERE business_id = NEW.business_id
         AND role = 'BO';

      SELECT COUNT(*) INTO cnt_authrep
        FROM authorized_representatives
       WHERE business_id = NEW.business_id;

      IF (cnt_mgmt + cnt_bo + cnt_authrep) = 0 THEN
        RAISE EXCEPTION 'Minimal isi salah satu: Pengurus (DIRECTOR/COMMISSIONER) atau BO atau Kuasa Bertindak';
      END IF;

      -- dokumen korporasi wajib
      SELECT COUNT(*) INTO cnt
        FROM documents d
       WHERE d.application_id = NEW.id
         AND d.doc_type IN ('AKTA_PENDIRIAN','NIB_SIUP','NPWP_BADAN');
      IF cnt < 3 THEN
        RAISE EXCEPTION 'Dokumen korporasi wajib: AKTA_PENDIRIAN, NIB/SIUP, NPWP_BADAN';
      END IF;

      -- identitas kuasa tetap wajib (sesuai aturan lama)
      SELECT COUNT(*) INTO cnt
        FROM documents d
       WHERE d.application_id = NEW.id
         AND d.doc_type IN ('KTP_KUASA','PASPOR_KUASA');
      IF cnt = 0 THEN
        RAISE EXCEPTION 'Unggah identitas kuasa (KTP/Paspor)';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_cdd_minimum ON applications;
CREATE TRIGGER trg_enforce_cdd_minimum
BEFORE UPDATE ON applications
FOR EACH ROW
EXECUTE FUNCTION enforce_cdd_minimum_before_submit();
