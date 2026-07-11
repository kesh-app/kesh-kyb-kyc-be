-- 0033_individual_doc_types.sql
-- Migrate legacy KTP/SIM/PASPOR docs to INDIVIDUAL_KTP_PHOTO for existing INDIVIDUAL applications.
-- Only migrates rows where no INDIVIDUAL_KTP_PHOTO doc already exists for that application.

UPDATE documents d
SET doc_type = 'INDIVIDUAL_KTP_PHOTO'
FROM applications a
WHERE d.application_id = a.id
  AND a.type = 'INDIVIDUAL'
  AND d.doc_type IN ('KTP', 'SIM', 'PASPOR')
  AND NOT EXISTS (
    SELECT 1 FROM documents d2
    WHERE d2.application_id = d.application_id
      AND d2.doc_type = 'INDIVIDUAL_KTP_PHOTO'
  );
