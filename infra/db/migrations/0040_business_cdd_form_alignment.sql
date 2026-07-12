-- 0040_business_cdd_form_alignment.sql
-- Align Business (KYB) CDD schema with the latest form.
--   1. business_entities: deed_number (Akta), company_email, main PIC, verification/signature
--   2. business_parties : ownership %, address, identity doc type, BO source of funds/wealth
--   3. business_party_role: add SHAREHOLDER (Pemegang Saham)
--   4. submit trigger: accept new business document type names (keep legacy names working)
-- Additive & idempotent. Preserves existing data.

-- ── 3 first: enum value harus ditambah sebelum dipakai di transaksi lain ─────
ALTER TYPE business_party_role ADD VALUE IF NOT EXISTS 'SHAREHOLDER';

-- ── 1. business_entities — kolom baru form terbaru ───────────────────────────
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS deed_number                   TEXT;
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS company_email                 TEXT;
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS pic_name                      TEXT;
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS pic_position                  TEXT;
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS pic_identity_number           TEXT;
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS pic_identity_type             TEXT;
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS representative_signature_name TEXT;
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS verification_officer          TEXT;
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS supervisor                    TEXT;

-- Preserve old data: nilai lama "Nomor Lisensi" (business_license_number) dipetakan
-- ke deed_number di bawah label baru "Nomor Akta". business_license_number ke depan
-- dipakai kembali sebagai "Nomor Izin Usaha" (NIB/OSS/SIUP).
UPDATE business_entities
   SET deed_number = business_license_number
 WHERE deed_number IS NULL
   AND business_license_number IS NOT NULL;

-- ── 2. business_parties — detail pemegang saham & BO ─────────────────────────
ALTER TABLE business_parties ADD COLUMN IF NOT EXISTS ownership_percentage   NUMERIC(5,2);
ALTER TABLE business_parties ADD COLUMN IF NOT EXISTS address                TEXT;
ALTER TABLE business_parties ADD COLUMN IF NOT EXISTS identity_document_type TEXT;
ALTER TABLE business_parties ADD COLUMN IF NOT EXISTS source_of_funds        TEXT;
ALTER TABLE business_parties ADD COLUMN IF NOT EXISTS source_of_wealth       TEXT;

-- ── 4. Submit trigger — terima nama dokumen bisnis baru + legacy ─────────────
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

      -- Dokumen korporasi wajib: akta, izin usaha, dan NPWP badan.
      -- Terima nama baru (BUSINESS_*) maupun legacy (AKTA_PENDIRIAN/NIB_SIUP/NPWP_BADAN).
      SELECT COUNT(DISTINCT
               CASE
                 WHEN d.doc_type IN ('AKTA_PENDIRIAN','BUSINESS_DEED_ESTABLISHMENT_AMENDMENT') THEN 'DEED'
                 WHEN d.doc_type IN ('NIB_SIUP','BUSINESS_LICENSE')                            THEN 'LICENSE'
                 WHEN d.doc_type IN ('NPWP_BADAN','BUSINESS_NPWP')                             THEN 'NPWP'
               END)
        INTO cnt
        FROM documents d
       WHERE d.application_id = NEW.id
         AND d.status <> 'FAILED'
         AND d.doc_type IN (
           'AKTA_PENDIRIAN','BUSINESS_DEED_ESTABLISHMENT_AMENDMENT',
           'NIB_SIUP','BUSINESS_LICENSE',
           'NPWP_BADAN','BUSINESS_NPWP'
         );
      IF cnt < 3 THEN
        RAISE EXCEPTION 'Dokumen korporasi wajib: Akta Pendirian, NIB/Izin Usaha, dan NPWP Badan harus semua ada';
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
