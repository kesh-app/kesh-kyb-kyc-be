-- 0047_other_dropdown_and_business_kyb_adjustments.sql
-- A. "Lainnya" manual free-text companions for dropdown fields.
--    RBA V01 rule: the *_other column NEVER replaces the dropdown value. The
--    dropdown value (e.g. source_of_funds = 'Lainnya') is preserved for strict
--    RBA V01 scoring; the manual description is stored separately in *_other.
-- B. Business/KYB address dropdown (province/city) columns, mirroring Individual CDD.
-- All columns nullable & additive (ADD COLUMN IF NOT EXISTS) — idempotent, preserves data.

-- ── A. persons — "Lainnya" companions ────────────────────────────────────────
ALTER TABLE persons ADD COLUMN IF NOT EXISTS occupation_other                     TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS source_of_funds_other                TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS business_relationship_purpose_other  TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS industry_category_other              TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS wic_transaction_purpose_other        TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS wic_recipient_relationship_other     TEXT;

-- ── A. business_entities — "Lainnya" companions ──────────────────────────────
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS legal_form_other                    TEXT;
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS business_activity_other             TEXT;
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS source_of_funds_other               TEXT;
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS business_relationship_purpose_other TEXT;

-- ── B. business_entities — Alamat Kedudukan dropdown (province/city) ──────────
-- Structured dropdown fields (mirror Individual CDD). The existing free-text
-- columns address_line / city / province are kept for detailed street text.
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS business_province_code VARCHAR(10);
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS business_province_name VARCHAR(100);
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS business_city_code     VARCHAR(10);
ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS business_city_name     VARCHAR(100);

-- ── A. business_parties — "Lainnya" companions ───────────────────────────────
ALTER TABLE business_parties ADD COLUMN IF NOT EXISTS source_of_funds_other  TEXT;
ALTER TABLE business_parties ADD COLUMN IF NOT EXISTS source_of_wealth_other TEXT;
