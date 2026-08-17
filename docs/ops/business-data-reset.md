# Business Data Reset (pre-go-live)

**Ini adalah alat operasional SEKALI PAKAI sebelum go-live. Ini BUKAN migrasi,
BUKAN reset database, dan tidak boleh dijadikan bagian dari alur deploy rutin.**

Skrip: `scripts/reset-business-data.cjs`

## 1. Tujuan

Menghapus seluruh data bisnis/operasional yang dihasilkan selama sanity/UAT,
sambil mempertahankan skema, master data, referensi, dan akun/otorisasi, supaya
lingkungan bisa dipakai go-live tanpa perlu re-provisioning.

## 2. Yang DIHAPUS

Allowlist eksplisit, dieksekusi dalam urutan dependensi FK (anak lebih dulu).
Tidak ada logika "hapus semua kecuali X" — tabel yang tidak terdaftar tidak
pernah disentuh.

| # | Tabel | Catatan |
|---|-------|---------|
| 1 | `notifications` | **`TRUNCATE`**, bukan `DELETE` — lihat §2a |
| 2 | `audit_logs` | **hanya** `object_type IN ('APPLICATION','TRANSFER','MONITORING_CASE')` |
| 3 | `generated_reports` | metadata report + objek file terkait |
| 4 | `monitoring_case_triggers` | |
| 5 | `monitoring_cases` | LTKT/LTKM |
| 6 | `statement_refunds` | |
| 7 | `complaints` | |
| 8 | `transfer_watchlist_hits` | hit per-transfer, bukan master |
| 9 | `transfer_compliance_reviews` | |
| 10 | `transfers` | |
| 11 | `transfer_batches` | termasuk artefak bulk/Qlola |
| 12 | `application_data_review_changes` | change-set ADR-047 |
| 13 | `application_data_reviews` | Pengkinian Data |
| 14 | `documents` | |
| 15 | `application_edd` | |
| 16 | `application_risk` | hasil RBA per aplikasi (bukan konfigurasi RBA) |
| 17 | `risk_profiles` | |
| 18 | `screening_results` | hasil screening per aplikasi, bukan master watchlist |
| 19 | `applications` | KYC/KYB, WIC & Our Customer |
| 20 | `authorized_representatives` | |
| 21 | `business_roles` | |
| 22 | `business_parties` | termasuk BO |
| 23 | `business_entities` | |
| 24 | `persons` | hanya baris yang sudah tidak dirujuk (lihat §4) |

## 2a. Kenapa `notifications` memakai TRUNCATE

Ini **satu-satunya pengecualian** dari strategi DELETE. Empat syarat diaudit
ulang sebelum go-live dan semuanya terpenuhi:

1. **Tidak ada FK masuk.** Katalog `information_schema` dicek: nol constraint
   yang menunjuk `notifications`. `TRUNCATE` **tanpa `CASCADE`** karena itu tidak
   mungkin menyentuh tabel lain — kalau nanti ada FK masuk, perintahnya akan
   gagal dan transaksi rollback, bukan diam-diam menghapus tabel tetangga.
2. **Tidak ada template/konfigurasi/master di tabel yang sama.** Skema migrasi
   `0066_notifications.sql` hanya berisi baris instance per-penerima. `type`
   dibatasi `CHECK (type IN ('ACTION_REQUIRED','INFO'))` — keduanya instance,
   bukan template. Judul/isi dirakit di kode; tidak ada tabel atau baris template
   di mana pun (`grep -i template src/modules/notifications` kosong).
3. **Setiap baris terikat entitas bisnis.** `object_type` dan `object_id` keduanya
   `NOT NULL`, nol baris melanggar, dan seluruh nilai `object_type` yang ada
   (`transfer`, `complaint`, `application`, `statement_refund`, `data_review`,
   `monitoring_case`) adalah entitas yang ikut dihapus reset ini.
4. **Tidak ada kewajiban retensi.** Komentar migrasi 0066 menyatakan tabel ini
   "a convenience layer" di atas layar worklist yang "remain the source of truth".
   Notifikasi adalah data turunan, bukan record of account.

Dipilih TRUNCATE karena volumenya (8jt+ baris di lingkungan sanity): `DELETE`
massal menghasilkan WAL besar dan dead tuple yang lalu menuntut `VACUUM`.

Aturan pemakaian:

- **TANPA `CASCADE`** — tidak boleh menyentuh tabel di luar allowlist.
- **TANPA `RESTART IDENTITY`** — sequence tidak pernah direset implisit (§7).
- **Tetap di dalam transaksi DB yang sama**; ikut `ROLLBACK` kalau ada yang gagal.
- **Dry-run tetap hanya `SELECT count(*)`** — tidak pernah menjalankan `TRUNCATE`.
- `--verify` tetap menuntut `notifications = 0`.
- Karena TRUNCATE tidak meninggalkan dead tuple, `notifications` **tidak** masuk
  saran `VACUUM ANALYZE` pasca-reset. Saran itu hanya untuk tabel yang benar-benar
  dihapus massal: `audit_logs`, `transfers`, `documents`.

## 3. Yang DIPERTAHANKAN

Master / auth / sistem — tidak pernah masuk daftar hapus:

- `users`, `roles`, `branches` — akun, peran, dan kantor
- `ref_provinces`, `ref_regencies`, `ref_districts`, `ref_villages` — master wilayah
- `ref_banks` — referensi bank/BIC, termasuk pemetaan Qlola
- `watchlist_entries`, `watchlist_sources` — master DTTOT/PPPSPM/sanksi/PEP
- `watchlist_ingest_logs` — riwayat impor master
- `schema_migrations` — riwayat migrasi
- `audit_logs` baris non-bisnis (mis. `USER_CREATE`)
- Konfigurasi RBA — **tidak ada di database**, ada di kode
  (`src/modules/applications/rba-v01.engine.ts`). Tidak terpengaruh sama sekali.

Kredensial dan konfigurasi provider berada di env/secret store, bukan di DB, jadi
juga tidak terpengaruh.

## 4. Strategi `persons`

`persons` dirujuk oleh empat tabel saja: `applications.person_id`,
`business_parties.person_id`, `authorized_representatives.person_id`,
`business_roles.person_id`. Keempatnya adalah data bisnis dan ikut dihapus.
Tidak ada seed/master yang menulis ke `persons` (`scripts/seed.cjs` hanya mengisi
`roles`, `branches`, `users`), jadi seluruh isi `persons` di lingkungan pra-go-live
adalah hasil sanity.

Skrip tetap **tidak** menjalankan `DELETE FROM persons` polos. Penghapusan
dijalankan paling akhir dengan guard `NOT EXISTS` terhadap keempat tabel di atas.
Efeknya identik pada kondisi saat ini, tetapi kalau di masa depan ada tabel
sistem yang merujuk `persons`, tinggal tambahkan guard-nya dan baris terkait akan
selamat, bukan terhapus diam-diam.

## 5. Storage (LOCAL & OBS)

Objek yang dihapus **hanya** key yang diturunkan dari baris DB, bukan sapuan
prefix, dan **tidak pernah** menghapus bucket atau direktori `uploads/`.

Sumber key:

| Domain | Kolom |
|--------|-------|
| Dokumen KYC/KYB | `documents.file_uri`, `documents.extracted_json->>'object_key'` |
| Staging ADR-047 | `application_data_review_changes.staged_object_key` (`uploads/_staging/data-review/...`) |
| Dokumen promosi ADR-047 | `documents.file_uri` (`uploads/kyc/kyb/<appId>/data-review/<reviewId>/<changeId>`) |
| Report | `generated_reports.object_key` (`uploads/reports/...`) |
| Lampiran transfer | `transfers.attachment_uri`, `transfers.result_attachment_uri` |
| Bukti refund | `statement_refunds.evidence_uri` |
| Berkas monitoring | `monitoring_cases.report_file_uri` |

Normalisasi key menerima bentuk `uploads/...` apa adanya (dipakai LOCAL maupun
OBS) dan URL `https://host/[api/]uploads/...`. URI dengan host asing (mis.
fixture `https://storage.test/...`) **dilewati** dan dilaporkan jumlahnya.
Penghapusan memakai `UploadsService.deleteObject()` milik aplikasi, sehingga
LOCAL dan OBS tertangani oleh kode yang sama tanpa kredensial tambahan.

Objek staging ADR-047 yatim yang tidak lagi punya baris DB adalah urusan
`scripts/cleanup-data-review-objects.cjs` — jalankan itu **sebelum** reset kalau
mau bersih total.

### Backend storage harus cocok dengan yang menulis berkasnya

Reset **hanya** menghapus lewat backend yang aktif saat itu, dan tidak pernah
menyeberang:

- Backend efektif dicetak sebelum konfirmasi: `Storage backend: LOCAL` +
  `Upload root: <path absolut>`, atau nama bucket untuk OBS.
- `UploadsService` **diam-diam fallback ke LOCAL** kalau `STORAGE_PROVIDER=HUAWEI_OBS`
  tapi env OBS tidak lengkap. Kalau itu terjadi, skrip melaporkan
  **`STORAGE_BACKEND_MISMATCH`**, **tidak menghapus objek apa pun**, menyimpan
  manifest, dan keluar dengan exit code ≠ 0. Tidak pernah menghapus di OBS saat
  dikonfigurasi LOCAL, atau di LOCAL saat dikonfigurasi OBS.
- Di LOCAL, key yang berkasnya tidak ada dilaporkan sebagai **`UNRESOLVED_OBJECT`**
  dan **tidak pernah dihitung sebagai terhapus** (`deleteLocal()` menelan ENOENT,
  jadi tanpa pemeriksaan ini key milik backend lain akan tampak "berhasil").
  Jumlahnya sudah terlihat sejak **dry-run**, bukan setelah baris DB hilang.

Severity: `STORAGE_BACKEND_MISMATCH` → **FAIL** di `--verify` dan fase storage
dibatalkan. `UNRESOLVED_OBJECT` → **WARN** menonjol (DB sudah bersih dan tidak ada
klaim palsu, tapi perlu ditindaklanjuti manusia).

### Yang TIDAK dihapus reset

Reset hanya menghapus objek otoritatif yang key-nya berasal dari baris DB. Berkas
yang tidak dirujuk baris DB mana pun — termasuk yang ada di prefix operasional
yang dikenal — **sengaja dipertahankan**. Berkas tak-dirujuk belum tentu sampah.
Audit terpisah, read-only:

```bash
node scripts/audit-business-storage-orphans.cjs
```

Alat itu mengklasifikasi isi `UPLOAD_DIR` menjadi A `REFERENCED_BUSINESS_OBJECT`,
B `KNOWN_BUSINESS_PREFIX_UNREFERENCED`, C `UNKNOWN_OR_OTHER`, D `PROTECTED/KEEP`,
lengkap dengan jumlah berkas, ukuran, prefix, dan rentang tanggal modifikasi.
**Tidak ada mode `--execute`** dan tidak ada penghapusan sama sekali — objek
kelas C khususnya memang dibiarkan utuh dan tidak boleh dihapus tanpa audit
tersendiri.

### Urutan fase

1. **FASE 1** — panen key dari DB, tulis manifest `.reset-storage-manifest.json`.
2. **FASE 2** — satu transaksi `BEGIN … COMMIT` untuk seluruh DELETE DB.
   Gagal di mana pun ⇒ `ROLLBACK`, storage tidak disentuh sama sekali.
3. **FASE 3** — hanya setelah COMMIT sukses: hapus objek dari manifest.

Manifest ditulis **sebelum** DB dihapus, jadi kalau proses mati setelah COMMIT,
daftar objek tidak ikut hilang bersama baris DB-nya dan tetap bisa diulang.

## 6. Prasyarat

- **Backup/snapshot DB wajib** dan diverifikasi bisa di-restore. Skrip menolak
  eksekusi tanpa `--backup-confirmed`. Skrip tidak melakukan snapshot otomatis —
  belum ada otomasi provider di repo ini.
- Backup direktori/bucket storage kalau objeknya masih dibutuhkan.
- `npm run build` sudah dijalankan (FASE 3 memuat `dist/modules/uploads/uploads.service`).
- Aplikasi dihentikan atau tidak menerima trafik saat reset berjalan.

## 7. Perintah

```bash
# Dry-run — default, nol aksi destruktif
node scripts/reset-business-data.cjs
node scripts/reset-business-data.cjs --dry-run

# Eksekusi (interaktif: akan meminta ketik RESET-KESH-BUSINESS-DATA)
ALLOW_BUSINESS_DATA_RESET=true \
  node scripts/reset-business-data.cjs --execute --backup-confirmed

# Eksekusi non-interaktif (CI/SSH tanpa TTY) — butuh flag tambahan
ALLOW_BUSINESS_DATA_RESET=true \
  node scripts/reset-business-data.cjs --execute --backup-confirmed --yes-i-am-sure

# Verifikasi
node scripts/reset-business-data.cjs --verify

# Ulangi hanya penghapusan storage yang gagal
node scripts/reset-business-data.cjs --storage-retry
```

Flag opsional `--reset-sequences` mereset sequence `id` tabel bisnis ke 1. **Tidak
pernah berjalan implisit.** ID internal yang melanjutkan dari nomor sanity adalah
kondisi yang dapat diterima; penomoran referensi publik (CIF, `reference_no`,
`report_no`, `public_id`) tidak bergantung pada sequence ini dan tidak berubah.

## 8. Pengaman

1. Mode default tanpa flag = dry-run.
2. `--execute` wajib eksplisit; `--verify` menang atas `--execute`.
3. `ALLOW_BUSINESS_DATA_RESET=true` wajib ada di environment.
4. `--backup-confirmed` wajib.
5. Konfirmasi interaktif: ketik persis `RESET-KESH-BUSINESS-DATA`.
6. Tanpa TTY, konfirmasi tidak dilewati diam-diam — wajib `--yes-i-am-sure`.
7. Sebelum konfirmasi, skrip mencetak DATABASE HOST, DATABASE NAME, DATABASE
   USER, NODE_ENV/APP_ENV, dan STORAGE BACKEND/TARGET. **Password, token, dan
   secret tidak pernah dicetak.**
8. Tidak ada `TRUNCATE`, tidak ada `DROP`, FK tidak pernah dinonaktifkan, migrasi
   tidak pernah dijalankan mundur.

## 9. Batasan rollback

**Tidak ada undo.** Setelah `COMMIT`, satu-satunya pemulihan adalah restore dari
backup DB. Objek storage yang sudah dihapus tidak bisa dikembalikan tanpa backup
storage. Ini alasan `--backup-confirmed` bersifat wajib.

## 10. Pemulihan kegagalan

| Kegagalan | Akibat | Tindakan |
|-----------|--------|----------|
| Error di FASE 2 | `ROLLBACK`, DB utuh, storage utuh | perbaiki penyebab, jalankan ulang |
| `dist` tidak ada saat FASE 3 | DB sudah bersih, storage utuh | `npm run build`, lalu `--storage-retry` |
| Sebagian objek gagal dihapus | DB bersih, sisa objek yatim | key sisa ditulis ulang ke manifest; jalankan `--storage-retry` |
| Proses mati setelah COMMIT | DB bersih, storage belum diproses | manifest sudah ada di disk; `--storage-retry` |
| `STORAGE_BACKEND_MISMATCH` | DB bersih, storage **tidak disentuh** | perbaiki env storage, lalu `--storage-retry` |
| `UNRESOLVED_OBJECT` | DB bersih, key tsb tidak ada di backend aktif | cek apakah objek ada di backend lain; `--storage-retry` mencoba ulang |

Kegagalan storage sebagian **tidak** dilaporkan sebagai sukses: exit code ≠ 0,
jumlah + daftar key yatim dicetak, dan `--verify` gagal selama manifest masih ada.

Setelah reset volume besar, disarankan `VACUUM ANALYZE` pada tabel yang benar-benar
dihapus massal: `audit_logs`, `transfers`, `documents`. **`notifications` tidak
termasuk** — TRUNCATE tidak meninggalkan dead tuple.

## 11. Verifikasi

`--verify` mencetak PASS/FAIL per pemeriksaan:

- setiap tabel di allowlist kosong, termasuk `notifications = 0` (`audit_logs`
  dicek pada filter bisnisnya)
- tidak ada orphan FK bisnis yang tersisa
- setiap tabel master masih berisi
- minimal satu `SystemAdmin` aktif masih ada
- `schema_migrations` jumlahnya sama dengan jumlah file migrasi
- backend storage aktif konsisten dengan yang dideklarasikan — FAIL kalau
  `STORAGE_BACKEND_MISMATCH`
- tidak ada objek storage tertunda di manifest
- `UNRESOLVED_OBJECT` dilaporkan sebagai **WARN** kalau ada
- baris `audit_logs` administratif yang dipertahankan dilaporkan (informasional)

Konfigurasi RBA tidak dicek karena tidak ada tabelnya — ada di kode.

## 12. Checklist manual pasca-reset

Skrip **tidak** membuat data smoke test. Setelah `--verify` PASS, jalankan manual:

- [ ] login SystemAdmin
- [ ] login FrontDesk
- [ ] buat Our Customer (INDIVIDUAL)
- [ ] buat WIC
- [ ] buat Business KYB
- [ ] submit + approve KYC
- [ ] buat transfer
- [ ] alur approval transfer (supervisor → finance → approve)
- [ ] finalisasi hasil provider
- [ ] resi / receipt
- [ ] akses report

## 13. Tes

```bash
npm run test:reset-script
```

Menguji logika murni (klasifikasi, urutan FK, guard, normalisasi key, tidak ada
kebocoran kredensial) dengan client DB palsu. Tidak menyentuh DB atau storage
nyata.
