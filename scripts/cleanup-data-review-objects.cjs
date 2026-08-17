#!/usr/bin/env node
/**
 * Pembersih objek storage milik Pengkinian Data (ADR-047).
 *
 * Dua jenis sampah yang bisa muncul:
 *   A. objek staging  `_staging/data-review/<reviewId>/...`
 *      dari review yang sudah selesai (APPROVED/REJECTED/CANCELLED) atau dari
 *      usulan yang dibatalkan (change row superseded).
 *   B. objek final hasil salinan promosi yang GAGAL commit
 *      `kyc/kyb/<appId>/data-review/<reviewId>/<changeId>...`
 *      yang tidak pernah dirujuk baris `documents` mana pun.
 *
 * ATURAN KESELAMATAN
 *   - DRY-RUN adalah default. Menghapus butuh --apply eksplisit.
 *   - Hanya menyentuh key ber-prefix data-review. Objek KYC/KYB biasa,
 *     resi, dan lampiran lain tidak pernah masuk daftar.
 *   - Key yang dirujuk `documents.file_uri` TIDAK PERNAH dihapus, apa pun
 *     statusnya. Pengecekan ini dilakukan per-key, bukan per-prefix.
 *   - Objek staging milik review yang MASIH AKTIF (DRAFT/SUBMITTED/
 *     RETURNED_FOR_REVISION) dilewati — draftnya belum selesai.
 *   - Idempotent: menjalankan ulang setelah sukses tidak menemukan apa-apa.
 *
 * Pemakaian:
 *   node scripts/cleanup-data-review-objects.cjs                 # dry-run
 *   node scripts/cleanup-data-review-objects.cjs --apply         # benar-benar hapus
 *   node scripts/cleanup-data-review-objects.cjs --min-age-days=14
 *   node scripts/cleanup-data-review-objects.cjs --review=123    # batasi satu review
 *
 * Kepemilikan: dijalankan manual oleh Ops saat housekeeping (mis. bulanan).
 * SENGAJA bukan scheduler — tidak ada subsistem cron di repo ini, dan sampahnya
 * kecil serta tidak mengganggu operasional.
 */

require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const MIN_AGE_DAYS = Number(
  (args.find((a) => a.startsWith('--min-age-days=')) || '--min-age-days=7').split('=')[1],
);
const ONLY_REVIEW = (args.find((a) => a.startsWith('--review=')) || '').split('=')[1] || null;

const STAGING_PREFIX_RE = /^(?:uploads\/)?_staging\/data-review\//;
const FINAL_PREFIX_RE = /^(?:uploads\/)?kyc\/kyb\/\d+\/data-review\/\d+\//;

/** Status review yang masih berjalan — stagingnya belum boleh disentuh. */
const ACTIVE_STATUSES = ['DRAFT', 'SUBMITTED', 'IN_COMPLIANCE_REVIEW', 'RETURNED_FOR_REVISION'];

function isDataReviewKey(key) {
  return typeof key === 'string' && (STAGING_PREFIX_RE.test(key) || FINAL_PREFIX_RE.test(key));
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log(
    `cleanup-data-review-objects — mode=${APPLY ? 'APPLY (menghapus)' : 'DRY-RUN'} ` +
      `min-age=${MIN_AGE_DAYS}d${ONLY_REVIEW ? ` review=${ONLY_REVIEW}` : ''}`,
  );

  // Kandidat: change-set DOCUMENT yang punya objek, dari review yang sudah
  // tidak aktif, dan usianya melewati ambang.
  const { rows: candidates } = await pool.query(
    `SELECT c.id            AS change_id,
            c.review_id,
            c.staged_object_key,
            c.superseded_at,
            c.promoted_at,
            c.updated_at,
            r.status        AS review_status,
            r.application_id
       FROM application_data_review_changes c
       JOIN application_data_reviews r ON r.id = c.review_id
      WHERE c.entity_type = 'DOCUMENT'
        AND c.staged_object_key IS NOT NULL
        AND c.updated_at < now() - ($1 || ' days')::interval
        AND ($2::bigint IS NULL OR c.review_id = $2::bigint)`,
    [String(MIN_AGE_DAYS), ONLY_REVIEW],
  );

  // Semua key yang dirujuk baris documents — daftar "jangan sentuh".
  const { rows: liveDocs } = await pool.query(
    `SELECT file_uri FROM documents WHERE file_uri IS NOT NULL`,
  );
  const referenced = new Set(liveDocs.map((d) => d.file_uri));

  const toDelete = [];
  const skipped = [];

  for (const c of candidates) {
    const key = c.staged_object_key;

    if (!isDataReviewKey(key)) {
      skipped.push({ key, reason: 'bukan key data-review (di luar cakupan alat ini)' });
      continue;
    }
    if (referenced.has(key)) {
      skipped.push({ key, reason: 'masih dirujuk baris documents' });
      continue;
    }
    if (ACTIVE_STATUSES.includes(c.review_status) && !c.superseded_at) {
      skipped.push({ key, reason: `review ${c.review_id} masih ${c.review_status}` });
      continue;
    }
    toDelete.push({ key, changeId: c.change_id, reviewId: c.review_id, status: c.review_status });
  }

  // Objek final yatim: hasil salinan promosi yang tidak pernah ter-commit.
  // Key-nya deterministik, jadi bisa dihitung ulang tanpa menelusuri bucket.
  const { rows: orphanCandidates } = await pool.query(
    `SELECT c.id AS change_id, c.review_id, r.application_id, c.staged_object_key
       FROM application_data_review_changes c
       JOIN application_data_reviews r ON r.id = c.review_id
      WHERE c.entity_type = 'DOCUMENT'
        AND c.operation IN ('ADD','REPLACE')
        AND c.promoted_at IS NULL
        AND c.staged_object_key IS NOT NULL
        AND r.status IN ('APPROVED','REJECTED','CANCELLED')
        AND ($1::bigint IS NULL OR c.review_id = $1::bigint)`,
    [ONLY_REVIEW],
  );
  for (const c of orphanCandidates) {
    const ext = c.staged_object_key.includes('.')
      ? c.staged_object_key.slice(c.staged_object_key.lastIndexOf('.'))
      : '';
    const logicalFinalKey = `kyc/kyb/${c.application_id}/data-review/${c.review_id}/${c.change_id}${ext}`;
    const obsConfigured =
      String(process.env.STORAGE_PROVIDER || '').toUpperCase() === 'HUAWEI_OBS' &&
      ['OBS_BUCKET_NAME', 'OBS_REGION', 'OBS_ENDPOINT',
        'HUAWEI_OBS_ACCESS_KEY_ID', 'HUAWEI_OBS_SECRET_ACCESS_KEY']
        .every((name) => Boolean(process.env[name]));
    const finalKey = obsConfigured ? logicalFinalKey : `uploads/${logicalFinalKey}`;
    if (referenced.has(finalKey)) {
      skipped.push({ key: finalKey, reason: 'objek final sudah dirujuk documents' });
      continue;
    }
    toDelete.push({ key: finalKey, changeId: c.change_id, reviewId: c.review_id, status: 'orphan-final' });
  }

  console.log(`\nKandidat hapus: ${toDelete.length}`);
  for (const d of toDelete) {
    console.log(`  [${d.status}] review=${d.reviewId} change=${d.changeId}  ${d.key}`);
  }
  console.log(`\nDilewati: ${skipped.length}`);
  for (const s of skipped) console.log(`  - ${s.key}  (${s.reason})`);

  if (!APPLY) {
    console.log('\nDRY-RUN — tidak ada yang dihapus. Jalankan ulang dengan --apply bila daftar di atas sudah benar.');
    await pool.end();
    return;
  }

  // Penghapusan sengaja memakai adapter storage aplikasi supaya LOCAL dan OBS
  // sama-sama tertangani, dan tidak ada kredensial baru yang perlu dikelola.
  const { UploadsService } = require('../dist/modules/uploads/uploads.service');
  const uploads = new UploadsService();
  uploads.onModuleInit();

  let ok = 0;
  let fail = 0;
  for (const d of toDelete) {
    try {
      await uploads.deleteObject(d.key);
      // staged_object_key dikosongkan supaya jalannya idempotent: run berikutnya
      // tidak lagi menganggapnya kandidat. Baris change-set-nya TIDAK dihapus —
      // itu bukti audit permanen.
      if (d.status !== 'orphan-final') {
        await pool.query(
          `UPDATE application_data_review_changes
              SET staged_object_key = NULL, updated_at = now()
            WHERE id = $1`,
          [d.changeId],
        );
      }
      ok++;
    } catch (e) {
      console.error(`  gagal menghapus ${d.key}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\nSelesai — dihapus ${ok}, gagal ${fail}.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
