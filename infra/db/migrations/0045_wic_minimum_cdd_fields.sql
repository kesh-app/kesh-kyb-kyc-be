-- 0045_wic_minimum_cdd_fields.sql
-- Store Walk-In Customer (WIC) minimum CDD transaction-purpose fields.

ALTER TABLE persons
  ADD COLUMN IF NOT EXISTS wic_transaction_purpose TEXT,
  ADD COLUMN IF NOT EXISTS wic_recipient_relationship TEXT;
