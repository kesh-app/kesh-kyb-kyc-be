-- 0072_data_review_change_sets.sql
-- Pengkinian Data — draft/change-set + promosi atomik (ADR-047).
--
-- MASALAH YANG DIPERBAIKI
-- Sampai 0071, "Pengkinian Data" hanya melacak workflow (0054). Tidak ada
-- tempat menyimpan usulan perubahan, sehingga:
--   a) field scalar person/business TIDAK BISA diubah sama sekali saat review
--      berjalan (updateIndividualCdd/updateBusinessCdd menolak status APPROVED), dan
--   b) dokumen/party/EDD justru langsung mengubah data LIVE tanpa gate apa pun.
-- Migrasi ini menambah lapisan staging supaya data pengguna jasa TIDAK berubah
-- sebelum Compliance menyetujui.
--
-- YANG TIDAK BERUBAH: applications.status tetap APPROVED sepanjang siklus
-- pengkinian. Tidak ada flip status aplikasi hanya demi menembus gate lama.
--
-- Additive only. Idempotent: aman dijalankan ulang.

-- ── A. Tabel change-set ─────────────────────────────────────────────────────
-- Satu baris = satu usulan mutasi. Baris yang digantikan edit berikutnya
-- ditandai superseded_at (BUKAN dihapus) supaya jejak "sempat diubah lalu
-- diralat" tetap ada. Setelah promosi, baris tetap disimpan permanen sebagai
-- bukti audit — jangan pernah di-DELETE.
CREATE TABLE IF NOT EXISTS application_data_review_changes (
  id                 BIGSERIAL PRIMARY KEY,
  public_id          UUID NOT NULL DEFAULT gen_random_uuid(),
  review_id          BIGINT NOT NULL
                       REFERENCES application_data_reviews(id) ON DELETE CASCADE,

  entity_type        VARCHAR(20) NOT NULL
                       CHECK (entity_type IN ('PERSON','BUSINESS','PARTY','DOCUMENT','EDD')),
  -- PK baris live yang disasar. NULL untuk ADD (barisnya belum ada).
  target_id          BIGINT NULL,
  operation          VARCHAR(10) NOT NULL
                       CHECK (operation IN ('ADD','UPDATE','DELETE','REPLACE')),

  -- Snapshot nilai live SAAT staging. Dipakai dua hal: tampilan diff "sebelum"
  -- untuk Compliance, dan pengecekan drift saat promosi (kalau live sudah
  -- berubah di luar review ini → 409, bukan timpa diam-diam).
  before_data        JSONB NULL,
  -- Nilai usulan. NULL untuk DELETE.
  after_data         JSONB NULL,

  -- DOCUMENT saja: object key di prefix staging sebelum dipromosikan.
  staged_object_key  TEXT NULL,

  -- Diisi saat promosi berhasil. promoted_target_id merekam PK live hasil ADD
  -- supaya retry promosi bisa idempotent (lihat DOCUMENT promotion).
  promoted_target_id BIGINT NULL,
  promoted_at        TIMESTAMPTZ NULL,

  -- Diisi saat baris ini digantikan usulan yang lebih baru untuk sasaran sama.
  superseded_at      TIMESTAMPTZ NULL,

  created_by         BIGINT NOT NULL REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_adrc_public_id
  ON application_data_review_changes(public_id);

-- Query terpanas: ambil semua usulan aktif satu review (draft read model,
-- diff Compliance, promosi). Partial index karena baris superseded tidak
-- pernah ikut di jalur itu.
CREATE INDEX IF NOT EXISTS idx_adrc_review_active
  ON application_data_review_changes(review_id)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_adrc_review_entity
  ON application_data_review_changes(review_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_adrc_target
  ON application_data_review_changes(entity_type, target_id)
  WHERE target_id IS NOT NULL;

-- ── B. Metadata konkurensi & baseline di review ─────────────────────────────
DO $$
BEGIN
  -- version: dinaikkan tiap mutasi draft. Submit & approve wajib membawa versi
  -- yang mereka baca terakhir → approval atas draft basi ditolak 409.
  ALTER TABLE application_data_reviews
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

  -- Versi saat FrontDesk menekan submit. Compliance mereview versi ini; kalau
  -- draft bergerak lagi setelahnya, approval-nya ditolak.
  ALTER TABLE application_data_reviews
    ADD COLUMN IF NOT EXISTS submitted_version INTEGER NULL;

  -- Digest isi data live saat review dimulai. persons/business_entities/
  -- documents TIDAK punya updated_at (cek information_schema), jadi tidak ada
  -- sinyal revisi per-baris yang bisa dipakai — digest konten adalah sinyal
  -- terkuat yang tersedia tanpa menambah kolom ke tabel inti KYC.
  ALTER TABLE application_data_reviews
    ADD COLUMN IF NOT EXISTS baseline_digest TEXT NULL;

  ALTER TABLE application_data_reviews
    ADD COLUMN IF NOT EXISTS baseline_captured_at TIMESTAMPTZ NULL;

  -- Jangkar siklus periodik berikutnya. SENGAJA hanya dicatat di sini;
  -- perhitungan due-date belum diubah di task ini (lihat ADR-047 §L).
  ALTER TABLE application_data_reviews
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ NULL;

  -- Kompatibilitas review lama. V1 = dibuat sebelum arsitektur change-set;
  -- decision()-nya tetap flip status polos tanpa promosi (tidak ada yang bisa
  -- dipromosikan — stagingnya memang belum pernah ada). V2 = alur baru.
  ALTER TABLE application_data_reviews
    ADD COLUMN IF NOT EXISTS changes_model VARCHAR(10) NOT NULL DEFAULT 'V2';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'application_data_reviews_changes_model_check'
  ) THEN
    ALTER TABLE application_data_reviews
      ADD CONSTRAINT application_data_reviews_changes_model_check
      CHECK (changes_model IN ('V1','V2'));
  END IF;
END $$;

-- ── C. Tandai review lama sebagai V1 ────────────────────────────────────────
-- Hanya baris yang SUDAH ADA saat migrasi ini jalan. Review baru memakai
-- DEFAULT 'V2'. Tidak ada change-set palsu yang dikarang untuk review lama —
-- data live mereka memang sudah terlanjur jadi apa adanya di model lama.
UPDATE application_data_reviews
   SET changes_model = 'V1'
 WHERE changes_model = 'V2'
   AND created_at < now();

-- Review lama yang masih aktif (DRAFT/SUBMITTED/RETURNED_FOR_REVISION) boleh
-- dilanjutkan memakai endpoint draft baru: begitu mutasi draft pertama masuk,
-- service menaikkan changes_model ke 'V2' dan mengisi baseline saat itu juga
-- (lihat data-reviews.service.ts ensureV2). Tidak ada backfill di sini karena
-- baseline harus diambil pada saat pemakaian, bukan saat migrasi.
