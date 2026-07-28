-- 0055_statement_refunds.sql
-- Statement Refund / Pencatatan Refund — layer audit ke-2 dari penanganan refund.
--
-- Tiga layer terpisah (jangan digabung):
--   1. complaints            → pengaduan customer/partner (dana belum masuk)
--   2. statement_refunds     → dana refund/return yang ditemukan di rekening koran KESH
--   3. balance event         → kredit saldo partner, HANYA setelah approval FinanceManager
--
-- Refund TIDAK otomatis menutup complaint, dan pembuatan refund TIDAK otomatis
-- mengkredit saldo. Kredit saldo wajib lewat approval FinanceManager.
--
-- Catatan integrasi: repo ini belum punya modul/tabel balance_events. Kolom
-- balance_event_id sengaja disediakan tanpa FK sebagai batas integrasi; status
-- BALANCE_CREDITED baru dipakai kalau posting saldo sudah tersedia.
--
-- Idempotent: aman dijalankan ulang.

CREATE TABLE IF NOT EXISTS statement_refunds (
  id                     BIGSERIAL PRIMARY KEY,
  refund_no              VARCHAR(50) UNIQUE NOT NULL,

  -- linkage (dua-duanya opsional: refund bisa ditemukan langsung dari rekonsiliasi)
  complaint_id           BIGINT NULL REFERENCES complaints(id),
  original_transfer_id   BIGINT NULL REFERENCES transfers(id),
  partner_application_id BIGINT NULL REFERENCES applications(id),

  -- data rekening koran
  statement_date         DATE NOT NULL,
  received_at            TIMESTAMPTZ NOT NULL,
  amount                 NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency               VARCHAR(3) NOT NULL DEFAULT 'IDR',
  bank_account_no        VARCHAR(34) NULL,
  bank_name              VARCHAR(100) NULL,
  bank_reference_no      VARCHAR(64) NULL,
  statement_description  TEXT NULL,
  evidence_uri           TEXT NULL,

  -- matching ke transaksi asal
  match_method           VARCHAR(20) NULL
                           CHECK (match_method IN ('MANUAL','AUTO_SUGGESTED')),
  match_confidence       VARCHAR(10) NULL
                           CHECK (match_confidence IN ('HIGH','MEDIUM','LOW')),

  status                 VARCHAR(30) NOT NULL DEFAULT 'UNMATCHED'
                           CHECK (status IN (
                             'UNMATCHED',
                             'MATCHED',
                             'NEED_INVESTIGATION',
                             'PENDING_APPROVAL',
                             'APPROVED',
                             'BALANCE_CREDITED',
                             'REJECTED',
                             'DUPLICATE'
                           )),

  investigation_notes    TEXT NULL,
  finance_notes          TEXT NULL,
  rejection_reason       TEXT NULL,

  -- audit trail
  created_by             BIGINT NOT NULL REFERENCES users(id),
  matched_by             BIGINT NULL REFERENCES users(id),
  submitted_by           BIGINT NULL REFERENCES users(id),
  approved_by            BIGINT NULL REFERENCES users(id),
  rejected_by            BIGINT NULL REFERENCES users(id),

  -- diisi modul balance kalau/ketika tersedia (tanpa FK: tabelnya belum ada)
  balance_event_id       BIGINT NULL,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  matched_at             TIMESTAMPTZ NULL,
  submitted_at           TIMESTAMPTZ NULL,
  approved_at            TIMESTAMPTZ NULL,
  rejected_at            TIMESTAMPTZ NULL,
  credited_at            TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_statement_refunds_status       ON statement_refunds(status);
CREATE INDEX IF NOT EXISTS idx_statement_refunds_complaint    ON statement_refunds(complaint_id);
CREATE INDEX IF NOT EXISTS idx_statement_refunds_transfer     ON statement_refunds(original_transfer_id);
CREATE INDEX IF NOT EXISTS idx_statement_refunds_partner      ON statement_refunds(partner_application_id);
CREATE INDEX IF NOT EXISTS idx_statement_refunds_stmt_date    ON statement_refunds(statement_date);
CREATE INDEX IF NOT EXISTS idx_statement_refunds_received_at  ON statement_refunds(received_at);

-- Guard duplikat mutasi bank yang sama. bank_account_no nullable → COALESCE
-- supaya NULL tetap dibandingkan. Hanya berlaku saat bank_reference_no terisi;
-- tanpa referensi bank, deteksi duplikat dilakukan di service level (tidak aman
-- dijadikan unique index karena mutasi kembar yang sah bisa saja terjadi).
CREATE UNIQUE INDEX IF NOT EXISTS uq_statement_refunds_bank_dedup
  ON statement_refunds (COALESCE(bank_account_no,''), bank_reference_no, amount, received_at)
  WHERE bank_reference_no IS NOT NULL AND bank_reference_no <> '';
