-- Transfer Recording v2 — SNAP-ready / audit-ready enhancement.
-- Idempotent: semua perubahan pakai IF NOT EXISTS sehingga aman dijalankan ulang.
-- TIDAK mengubah kolom lama; hanya menambah kolom baru + index + backfill.
-- TIDAK melakukan integrasi API bank/payment rail (hanya pencatatan internal).

-- ─────────────────────────────────────────────────────────────
-- Reference fields (SNAP partnerReferenceNo / referenceNo mapping)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS partner_reference_no   VARCHAR(64);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS reference_no           VARCHAR(64);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS external_reference_no  VARCHAR(64);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS bank_reference_no      VARCHAR(64);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS provider_reference_no  VARCHAR(64);

-- ─────────────────────────────────────────────────────────────
-- Source account / SNAP sourceAccount mapping
-- ─────────────────────────────────────────────────────────────
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS source_account_no    VARCHAR(34);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS source_account_name  VARCHAR(100);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS source_bank_code     VARCHAR(8);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS source_bank_name     VARCHAR(100);

-- ─────────────────────────────────────────────────────────────
-- Beneficiary enhancement (SNAP beneficiary* mapping)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS beneficiary_address             VARCHAR(255);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS beneficiary_email              VARCHAR(100);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS beneficiary_customer_residence VARCHAR(2);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS beneficiary_customer_type      VARCHAR(2);

-- ─────────────────────────────────────────────────────────────
-- Amount normalization (SNAP amount.value / amount.currency)
-- Kolom lama amount NUMERIC(18,2) + currency TEXT dipertahankan.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS amount_value    VARCHAR(32);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS amount_currency VARCHAR(3);

-- ─────────────────────────────────────────────────────────────
-- Operational fields
-- ─────────────────────────────────────────────────────────────
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS transfer_method          VARCHAR(32) DEFAULT 'BANK_TRANSFER';
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS transfer_channel         VARCHAR(32) DEFAULT 'MANUAL';
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS transaction_date         TIMESTAMPTZ;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS requested_execution_date TIMESTAMPTZ;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS completed_at             TIMESTAMPTZ;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS failed_at                TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────
-- Decision / audit trail fields
-- ─────────────────────────────────────────────────────────────
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS submitted_by         BIGINT REFERENCES users(id);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS rejected_by          BIGINT REFERENCES users(id);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS rejected_at          TIMESTAMPTZ;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS reject_reason        TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS decision_notes       TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS result_updated_by    BIGINT REFERENCES users(id);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS result_updated_at    TIMESTAMPTZ;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS result_reference_no  VARCHAR(64);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS result_attachment_uri TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS failed_reason        TEXT;

-- ─────────────────────────────────────────────────────────────
-- SNAP / provider status fields
-- ─────────────────────────────────────────────────────────────
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS latest_transaction_status VARCHAR(16);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS transaction_status_desc   VARCHAR(150);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS provider_response_code    VARCHAR(16);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS provider_response_message VARCHAR(255);

-- ─────────────────────────────────────────────────────────────
-- Flexible JSON payload containers
-- ─────────────────────────────────────────────────────────────
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS additional_info   JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS provider_request  JSONB;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS provider_response JSONB;

-- ─────────────────────────────────────────────────────────────
-- Backfill existing rows so partner_reference_no selalu terisi & unik.
-- id unik → reference unik. Hanya isi yang masih NULL.
-- ─────────────────────────────────────────────────────────────
UPDATE transfers
SET partner_reference_no = 'KESH-TRF-' || to_char(COALESCE(created_at, now()), 'YYYYMMDD') || '-' || lpad(id::text, 8, '0')
WHERE partner_reference_no IS NULL;

-- Derive amount_value / amount_currency untuk baris lama.
UPDATE transfers
SET amount_value = to_char(amount, 'FM999999999999999990.00')
WHERE amount_value IS NULL AND amount IS NOT NULL;

UPDATE transfers
SET amount_currency = COALESCE(NULLIF(currency, ''), 'IDR')
WHERE amount_currency IS NULL;

-- Default operasional untuk baris lama.
UPDATE transfers SET transfer_method  = 'BANK_TRANSFER' WHERE transfer_method  IS NULL;
UPDATE transfers SET transfer_channel = 'MANUAL'        WHERE transfer_channel IS NULL;

-- ─────────────────────────────────────────────────────────────
-- Indexes
-- partner_reference_no: unique (NULL diizinkan ganda oleh Postgres, tapi
-- setelah backfill semua terisi & server selalu generate saat create).
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_transfers_partner_reference_no ON transfers(partner_reference_no);
CREATE INDEX IF NOT EXISTS idx_transfers_status                 ON transfers(status);
CREATE INDEX IF NOT EXISTS idx_transfers_result                 ON transfers(result);
CREATE INDEX IF NOT EXISTS idx_transfers_created_at             ON transfers(created_at);
CREATE INDEX IF NOT EXISTS idx_transfers_beneficiary_account_no ON transfers(beneficiary_account_number);
CREATE INDEX IF NOT EXISTS idx_transfers_bank_reference_no      ON transfers(bank_reference_no);
