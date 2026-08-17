-- Execution provider used by KESH to process the transfer. This is distinct
-- from beneficiary_bank_name, which identifies the destination bank.
-- Nullable preserves readability for legacy transfers; no guessed backfill.
ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS provider_name TEXT NULL;
