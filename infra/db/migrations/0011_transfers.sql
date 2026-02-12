DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_status') THEN
    CREATE TYPE transfer_status AS ENUM ('DRAFT','SUBMITTED','APPROVED','REJECTED','COMPLETED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_result') THEN
    CREATE TYPE transfer_result AS ENUM ('SUCCESS','FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS transfers (
  id BIGSERIAL PRIMARY KEY,
  branch_id BIGINT REFERENCES branches(id),

  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'IDR',

  beneficiary_bank_name TEXT NOT NULL,
  beneficiary_bank_code TEXT,
  beneficiary_account_number TEXT NOT NULL,
  beneficiary_account_name TEXT NOT NULL,

  description TEXT,
  requested_transfer_at DATE,
  attachment_uri TEXT,

  status transfer_status NOT NULL DEFAULT 'DRAFT',
  result transfer_result,
  result_notes TEXT,

  created_by BIGINT REFERENCES users(id),
  submitted_at TIMESTAMPTZ,
  approved_by BIGINT REFERENCES users(id),
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transfers_branch_status ON transfers(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_transfers_created_by    ON transfers(created_by);
CREATE INDEX IF NOT EXISTS idx_transfers_submitted_at  ON transfers(submitted_at);
