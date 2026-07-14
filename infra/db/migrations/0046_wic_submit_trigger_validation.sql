-- 0046_wic_submit_trigger_validation.sql
-- Make the CDD submit trigger aware of Walk-In Customer (WIC) individuals.
--
-- Problem: enforce_cdd_minimum_before_submit() (last defined in 0042) enforced the
-- full INDIVIDUAL CDD (phone, nationality, occupation, gender, selfie & selfie-with-KTP
-- photos) for EVERY individual application. A WIC person does not carry those fields,
-- so submitting a valid WIC raised 'KYC CDD minimum (INDIVIDUAL) belum lengkap' and
-- surfaced as a 500. The service-level validateBeforeSubmit already branches on WIC;
-- this migration aligns the DB backstop.
--
-- Behaviour:
--   * INDIVIDUAL + persons.cif_relationship_type = 'WIC'
--       → validate only the WIC minimum: identity + place/date of birth +
--         transaction purpose + recipient relationship, and the two WIC documents
--         (identity + signature/biometric). Legacy identity/signature doc names are
--         still accepted so existing uploads keep working.
--   * INDIVIDUAL + anything else (OUR_CUSTOMER) → unchanged full INDIVIDUAL CDD.
--   * BUSINESS → unchanged (identical to 0042).
-- Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION enforce_cdd_minimum_before_submit() RETURNS trigger AS $$
DECLARE
  cnt INT;
  rel TEXT;
  has_deed     BOOLEAN;
  has_license  BOOLEAN;
  has_npwp     BOOLEAN;
  has_mgmt     BOOLEAN;
  has_sh_doc   BOOLEAN;
  has_bo_doc   BOOLEAN;
  needs_sh     BOOLEAN;
  needs_bo     BOOLEAN;
  missing_docs TEXT := '';
BEGIN
  IF NEW.status = 'SUBMITTED' AND OLD.status <> 'SUBMITTED' THEN

    -- ── INDIVIDUAL ──
    IF NEW.type = 'INDIVIDUAL' THEN

      SELECT COALESCE(p.cif_relationship_type, 'OUR_CUSTOMER')
        INTO rel
        FROM persons p
       WHERE p.id = NEW.person_id;

      IF rel = 'WIC' THEN
        -- ── WIC minimum CDD (identitas + tujuan transaksi) ──
        PERFORM 1 FROM persons p
         WHERE p.id = NEW.person_id
           AND p.full_name IS NOT NULL AND length(trim(p.full_name)) > 0
           AND p.identity_type IS NOT NULL
           AND p.identity_number IS NOT NULL AND length(trim(p.identity_number)) > 0
           AND p.address_identity IS NOT NULL AND length(trim(p.address_identity)) > 0
           AND p.pob IS NOT NULL
           AND p.dob IS NOT NULL
           AND p.wic_transaction_purpose IS NOT NULL AND length(trim(p.wic_transaction_purpose)) > 0
           AND p.wic_recipient_relationship IS NOT NULL AND length(trim(p.wic_recipient_relationship)) > 0;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'WIC CDD minimum belum lengkap — periksa data person (identitas & tujuan transaksi)';
        END IF;

        -- Dokumen Identitas WIC (terima nama WIC atau legacy identitas)
        IF NOT EXISTS (
          SELECT 1 FROM documents d
           WHERE d.application_id = NEW.id
             AND d.status <> 'FAILED'
             AND d.doc_type IN ('WIC_IDENTITY_DOCUMENT','INDIVIDUAL_KTP_PHOTO','KTP','SIM','PASPOR')
        ) THEN
          RAISE EXCEPTION 'WIC CDD minimum belum lengkap: Dokumen Identitas WIC';
        END IF;

        -- Tanda Tangan / Biometrik WIC
        IF NOT EXISTS (
          SELECT 1 FROM documents d
           WHERE d.application_id = NEW.id
             AND d.status <> 'FAILED'
             AND d.doc_type IN ('WIC_SIGNATURE_BIOMETRIC','WIC_SIGNATURE','SIGNATURE','BIOMETRIC')
        ) THEN
          RAISE EXCEPTION 'WIC CDD minimum belum lengkap: Tanda Tangan / Biometrik WIC';
        END IF;

      ELSE
        -- ── OUR_CUSTOMER: full INDIVIDUAL CDD (unchanged) ──
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
      END IF;

    -- ── BUSINESS (unchanged from 0042) ──
    ELSIF NEW.type = 'BUSINESS' THEN
      -- Data inti entitas (tanpa nib/business_license_number — dicek terpisah OR).
      PERFORM 1 FROM business_entities b
       WHERE b.id = NEW.business_id
         AND b.legal_name IS NOT NULL AND length(trim(b.legal_name)) > 0
         AND b.legal_form IS NOT NULL
         AND b.incorporation_date IS NOT NULL
         AND b.incorporation_place IS NOT NULL
         AND b.npwp IS NOT NULL AND length(trim(b.npwp)) > 0
         AND b.address_line IS NOT NULL AND length(trim(b.address_line)) > 0
         AND b.business_activity IS NOT NULL
         AND b.phone IS NOT NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'KYB CDD minimum (BUSINESS) belum lengkap — periksa data business entity';
      END IF;

      -- Nomor Izin Usaha: cukup salah satu dari business_license_number ATAU nib.
      IF NOT EXISTS (
        SELECT 1 FROM business_entities b
         WHERE b.id = NEW.business_id
           AND ( (b.business_license_number IS NOT NULL AND length(trim(b.business_license_number)) > 0)
              OR (b.nib IS NOT NULL AND length(trim(b.nib)) > 0) )
      ) THEN
        RAISE EXCEPTION 'Nomor Izin Usaha (NIB/OSS/SIUP/dll) wajib diisi.';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM business_parties
         WHERE business_id = NEW.business_id
           AND is_active = TRUE
           AND role IN ('DIRECTOR','COMMISSIONER','BO','AUTHORIZED_REP')
      ) THEN
        RAISE EXCEPTION 'Minimal isi salah satu party: DIRECTOR, COMMISSIONER, BO, atau AUTHORIZED_REP';
      END IF;

      has_deed := EXISTS (SELECT 1 FROM documents d WHERE d.application_id = NEW.id AND d.status <> 'FAILED'
                            AND d.doc_type IN ('AKTA_PENDIRIAN','BUSINESS_DEED_ESTABLISHMENT_AMENDMENT'));
      has_license := EXISTS (SELECT 1 FROM documents d WHERE d.application_id = NEW.id AND d.status <> 'FAILED'
                            AND d.doc_type IN ('NIB_SIUP','BUSINESS_LICENSE'));
      has_npwp := EXISTS (SELECT 1 FROM documents d WHERE d.application_id = NEW.id AND d.status <> 'FAILED'
                            AND d.doc_type IN ('NPWP_BADAN','BUSINESS_NPWP'));
      has_mgmt := EXISTS (SELECT 1 FROM documents d WHERE d.application_id = NEW.id AND d.status <> 'FAILED'
                            AND d.doc_type IN ('BUSINESS_MANAGEMENT_IDENTITY'));
      has_sh_doc := EXISTS (SELECT 1 FROM documents d WHERE d.application_id = NEW.id AND d.status <> 'FAILED'
                            AND d.doc_type IN ('BUSINESS_SHAREHOLDER_IDENTITY_25'));
      has_bo_doc := EXISTS (SELECT 1 FROM documents d WHERE d.application_id = NEW.id AND d.status <> 'FAILED'
                            AND d.doc_type IN ('BUSINESS_BO_DOCUMENT'));

      needs_sh := EXISTS (SELECT 1 FROM business_parties
                            WHERE business_id = NEW.business_id AND is_active = TRUE
                              AND role = 'SHAREHOLDER' AND COALESCE(ownership_percentage, 0) >= 25);
      needs_bo := EXISTS (SELECT 1 FROM business_parties
                            WHERE business_id = NEW.business_id AND is_active = TRUE
                              AND role = 'BO');

      IF NOT has_deed    THEN missing_docs := missing_docs || ', Akta Pendirian & Perubahan'; END IF;
      IF NOT has_license THEN missing_docs := missing_docs || ', NIB / Izin Usaha'; END IF;
      IF NOT has_npwp    THEN missing_docs := missing_docs || ', NPWP Badan Usaha'; END IF;
      IF NOT has_mgmt    THEN missing_docs := missing_docs || ', Dokumen Identitas Pengurus'; END IF;
      IF needs_sh AND NOT has_sh_doc THEN missing_docs := missing_docs || ', Dokumen Identitas Pemegang Saham ≥25%'; END IF;
      IF needs_bo AND NOT has_bo_doc THEN missing_docs := missing_docs || ', Dokumen BO'; END IF;

      IF length(missing_docs) > 0 THEN
        RAISE EXCEPTION 'Dokumen wajib belum lengkap: %', substr(missing_docs, 3);
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
