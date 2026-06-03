-- 0015_fix_trigger_and_schema.sql
-- Tujuan:
--   1. Ganti fungsi trigger CDD agar memakai business_parties (bukan business_roles/authorized_representatives)
--   2. Pastikan kolom decision_at ada di applications (untuk endpoint /decision)
--   3. Drop index expression upper(unique_id) sudah benar di 0006 — tidak perlu diubah;
--      logic upsert kini ditangani di layer aplikasi (watchlist.service.ts).

-- ── 1. Pastikan kolom decision_at & decision_reason ada (sudah ada di 0003, ini defensive) ──
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS decision_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_reason TEXT,
  ADD COLUMN IF NOT EXISTS decision_by BIGINT;

-- ── 2. Ganti fungsi trigger enforce_cdd_minimum_before_submit ──
--    Menghapus ketergantungan ke business_roles & authorized_representatives,
--    memakai business_parties sepenuhnya.
--    Juga menghapus syarat KTP_KUASA/PASPOR_KUASA yang sudah tidak relevan.

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
         AND p.gender IS NOT NULL
         AND p.signature_uri IS NOT NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'KYC CDD minimum (INDIVIDUAL) belum lengkap — periksa data person';
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

      -- Minimal 1 party aktif dari business_parties (bukan legacy business_roles)
      IF NOT EXISTS (
        SELECT 1 FROM business_parties
         WHERE business_id = NEW.business_id
           AND is_active = TRUE
           AND role IN ('DIRECTOR','COMMISSIONER','BO','AUTHORIZED_REP')
      ) THEN
        RAISE EXCEPTION 'Minimal isi salah satu party: DIRECTOR, COMMISSIONER, BO, atau AUTHORIZED_REP';
      END IF;

      -- Dokumen korporasi wajib (ketiga-tiganya harus ada)
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

-- Re-attach trigger (sudah ada dari 0004, di-drop & recreate agar bersih)
DROP TRIGGER IF EXISTS trg_enforce_cdd_minimum ON applications;
CREATE TRIGGER trg_enforce_cdd_minimum
  BEFORE UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION enforce_cdd_minimum_before_submit();
