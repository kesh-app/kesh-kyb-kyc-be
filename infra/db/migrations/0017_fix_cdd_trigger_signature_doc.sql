-- 0017_fix_cdd_trigger_signature_doc.sql
-- Tujuan:
--   Izinkan signature via dokumen SIGNATURE di application_documents,
--   tidak wajib persons.signature_uri.
--   Signature dianggap valid jika:
--     A. persons.signature_uri IS NOT NULL
--     OR
--     B. Ada dokumen aktif dengan doc_type = 'SIGNATURE' di tabel documents

CREATE OR REPLACE FUNCTION enforce_cdd_minimum_before_submit() RETURNS trigger AS $$
DECLARE
  cnt INT;
BEGIN
  IF NEW.status = 'SUBMITTED' AND OLD.status <> 'SUBMITTED' THEN

    -- ── INDIVIDUAL ──
    IF NEW.type = 'INDIVIDUAL' THEN
      -- Cek data dasar person (tanpa signature_uri — dicek terpisah di bawah)
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

      -- Cek signature: boleh dari persons.signature_uri ATAU dari dokumen SIGNATURE
      IF NOT EXISTS (
        SELECT 1 FROM persons p WHERE p.id = NEW.person_id AND p.signature_uri IS NOT NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM documents d
         WHERE d.application_id = NEW.id AND d.doc_type = 'SIGNATURE'
      ) THEN
        RAISE EXCEPTION 'Signature wajib: isi persons.signature_uri atau upload dokumen SIGNATURE';
      END IF;

      SELECT COUNT(*) INTO cnt FROM documents d
       WHERE d.application_id = NEW.id
         AND d.doc_type IN ('KTP','SIM','PASPOR');
      IF cnt = 0 THEN
        RAISE EXCEPTION 'Dokumen identitas (KTP/SIM/PASPOR) wajib diunggah';
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

-- Trigger sudah ada dari 0015, fungsi di-replace in-place sehingga tidak perlu recreate.
