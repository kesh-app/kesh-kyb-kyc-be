CREATE TABLE IF NOT EXISTS complaints (
  id                      BIGSERIAL PRIMARY KEY,
  complaint_no            VARCHAR(50) UNIQUE NOT NULL,
  customer_application_id BIGINT NOT NULL REFERENCES applications(id),
  customer_cif_no         VARCHAR(50) NULL,
  customer_name           VARCHAR(255) NOT NULL,
  customer_type           VARCHAR(50) NULL,
  transfer_id             BIGINT NULL REFERENCES transfers(id),
  transaction_reference   VARCHAR(100) NOT NULL,
  category                VARCHAR(50) NOT NULL DEFAULT 'TRANSFER',
  channel                 VARCHAR(50) NOT NULL DEFAULT 'WALK_IN',
  priority                VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  complaint_notes         TEXT NOT NULL,
  status                  VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  resolution_notes        TEXT NULL,
  created_by              BIGINT NOT NULL REFERENCES users(id),
  updated_by              BIGINT NULL REFERENCES users(id),
  resolved_by             BIGINT NULL REFERENCES users(id),
  resolved_at             TIMESTAMPTZ NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_complaints_complaint_no            ON complaints(complaint_no);
CREATE INDEX IF NOT EXISTS idx_complaints_customer_application_id ON complaints(customer_application_id);
CREATE INDEX IF NOT EXISTS idx_complaints_transfer_id             ON complaints(transfer_id);
CREATE INDEX IF NOT EXISTS idx_complaints_transaction_reference   ON complaints(transaction_reference);
CREATE INDEX IF NOT EXISTS idx_complaints_status                  ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_created_by              ON complaints(created_by);
CREATE INDEX IF NOT EXISTS idx_complaints_created_at              ON complaints(created_at);
