-- 0034_update_cdd_trigger_individual.sql
-- Update CDD minimum trigger for INDIVIDUAL applications:
--   1. Remove signature_uri requirement (no longer mandatory)
--   2. Accept INDIVIDUAL_KTP_PHOTO in addition to legacy KTP/SIM/PASPOR
--   3. Add checks for INDIVIDUAL_FACE_PHOTO and INDIVIDUAL_FACE_WITH_KTP_PHOTO

CREATE OR REPLACE FUNCTION enforce_cdd_minimum_before_submit() RETURNS trigger AS $$
DECLARE
  cnt INT;
BEGIN
  IF NEW.status = 'SUBMITTED' AND OLD.status <> 'SUBMITTED' THEN

    -- ── INDIVIDUAL ──
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
         AND p.gender IS NOT NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'KYC CDD minimum (INDIVIDUAL) belum lengkap — periksa data person';
      END IF;

      -- Foto KTP: accept new type or legacy
      SELECT COUNT(*) INTO cnt FROM documents d
       WHERE d.application_id = NEW.id
         AND d.doc_type IN ('INDIVIDUAL_KTP_PHOTO','KTP','SIM','PASPOR')
         AND d.status <> 'FAILED';
      IF cnt = 0 THEN
        RAISE EXCEPTION 'Dokumen foto KTP wajib ada (INDIVIDUAL_KTP_PHOTO/KTP/SIM/PASPOR)';
      END IF;

      -- Foto wajah
      IF NOT EXISTS (
        SELECT 1 FROM documents d
         WHERE d.application_id = NEW.id
           AND d.doc_type = 'INDIVIDUAL_FACE_PHOTO'
           AND d.status <> 'FAILED'
      ) THEN
        RAISE EXCEPTION 'Dokumen foto wajah (INDIVIDUAL_FACE_PHOTO) wajib ada';
      END IF;

      -- Foto wajah dengan KTP
      IF NOT EXISTS (
        SELECT 1 FROM documents d
         WHERE d.application_id = NEW.id
           AND d.doc_type = 'INDIVIDUAL_FACE_WITH_KTP_PHOTO'
           AND d.status <> 'FAILED'
      ) THEN
        RAISE EXCEPTION 'Dokumen foto wajah dengan KTP (INDIVIDUAL_FACE_WITH_KTP_PHOTO) wajib ada';
      END IF;

    -- ── BUSINESS ──
    ELSIF NEW.type = 'BUSINESS' THEN
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
        RAISE EXCEPTION 'KYB CDD minimum (BUSINESS) belum lengkap — periksa data business entity';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM business_parties
         WHERE business_id = NEW.business_id
           AND is_active = TRUE
           AND role IN ('DIRECTOR','COMMISSIONER','BO','AUTHORIZED_REP')
      ) THEN
        RAISE EXCEPTION 'Minimal isi salah satu party: DIRECTOR, COMMISSIONER, BO, atau AUTHORIZED_REP';
      END IF;

      SELECT COUNT(DISTINCT doc_type) INTO cnt
        FROM documents d
       WHERE d.application_id = NEW.id
         AND d.doc_type IN ('AKTA_PENDIRIAN','NIB_SIUP','NPWP_BADAN');
      IF cnt < 3 THEN
        RAISE EXCEPTION 'Dokumen korporasi wajib: AKTA_PENDIRIAN, NIB/SIUP, dan NPWP_BADAN harus semua ada';
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
