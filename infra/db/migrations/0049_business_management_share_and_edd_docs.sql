-- 0049_business_management_share_and_edd_docs.sql
-- Idempotent.
--
-- 1. Business/KYB "Pengurus dan Pemegang Saham": optional share ownership
--    percentage for Director (Direktur Utama) and Commissioner (Komisaris).
--    Stored on business_entities alongside the other management summary fields
--    (pic_name/pic_position/...). NUMERIC(5,2) mirrors business_parties.ownership_percentage
--    so decimals are supported. Both optional; app layer validates 0..100.
--
-- 2. EDD additional documents (Frontline): no schema change needed — the
--    documents table has no UNIQUE constraint on doc_type and doc_type is plain
--    TEXT, so multiple rows with doc_type = 'EDD_ADDITIONAL_DOCUMENT' are allowed.
--    Documented here for traceability.

ALTER TABLE business_entities
  ADD COLUMN IF NOT EXISTS director_share_percentage     NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS commissioner_share_percentage NUMERIC(5,2);

-- Guard rails at the DB level too (0..100 when provided).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_entities_director_share_pct_range'
  ) THEN
    ALTER TABLE business_entities
      ADD CONSTRAINT business_entities_director_share_pct_range
      CHECK (director_share_percentage IS NULL
             OR (director_share_percentage >= 0 AND director_share_percentage <= 100));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_entities_commissioner_share_pct_range'
  ) THEN
    ALTER TABLE business_entities
      ADD CONSTRAINT business_entities_commissioner_share_pct_range
      CHECK (commissioner_share_percentage IS NULL
             OR (commissioner_share_percentage >= 0 AND commissioner_share_percentage <= 100));
  END IF;
END$$;
