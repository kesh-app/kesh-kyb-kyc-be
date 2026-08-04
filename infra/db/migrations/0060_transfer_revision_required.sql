-- 0060_transfer_revision_required.sql
-- Status "Dikembalikan" untuk transfer.
--
-- FinanceStaff pada tahap PENDING_FINANCE_STAFF_REVIEW kini bisa MENGEMBALIKAN
-- transaksi untuk diperbaiki, bukan hanya approve / reject. Transfer yang
-- dikembalikan TIDAK final: FrontDesk boleh mengedit lalu submit ulang, dan
-- transfer mengulang alur normal dari awal (screening → SUBMITTED /
-- PENDING_COMPLIANCE_REVIEW → OperationSupervisor → FinanceStaff → FinanceManager).
--
-- Nama status mengikuti konvensi yang sudah dipakai alur KYC/KYB
-- (applications.status = 'REVISION_REQUIRED', migration 0048) supaya
-- "dikembalikan untuk diperbaiki" punya satu nama di seluruh sistem.
--
-- Tidak ada kolom baru: alasan pengembalian disimpan di finance_notes, aktor di
-- finance_reviewed_by, waktunya di finance_reviewed_at — kolom yang memang
-- sudah dipakai financeReview() untuk approve/reject.
--
-- Catatan: ALTER TYPE ... ADD VALUE tidak boleh dipakai pada transaksi yang sama
-- dengan yang menambahkannya. File ini sengaja hanya menambah nilai enum.

ALTER TYPE transfer_status
  ADD VALUE IF NOT EXISTS 'REVISION_REQUIRED' AFTER 'PENDING_FINANCE_MANAGER_APPROVAL';
