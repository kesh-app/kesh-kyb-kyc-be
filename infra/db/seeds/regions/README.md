# Region Reference Data

## Source

| Item | Detail |
|------|--------|
| Dataset | [github.com/cahyadsn/wilayah](https://github.com/cahyadsn/wilayah) — `db/wilayah.sql` |
| URL persis | `https://raw.githubusercontent.com/cahyadsn/wilayah/master/db/wilayah.sql` |
| Dasar hukum | Kepmendagri No. **300.2.2-2138 Tahun 2025** (tertulis di header dump) |
| Tanggal dump | dibuat 2025-05-25, revisi terakhir 2026-02-13 |
| Diunduh | **2026-08-10** |
| Lisensi | MIT |
| Code system | Kode Wilayah Administrasi Kemendagri, titik dibuang — prov 2, kab/kota 4, kecamatan **6**, desa/kel 10 digit |
| Provinsi | 38 — **lengkap** |
| Kab/Kota | 514 (416 kabupaten + 98 kota) — **lengkap** |
| Kecamatan | 7.285 — **lengkap** |
| Desa/Kelurahan | 83.762 (8.496 kelurahan + 75.266 desa) — **lengkap** |

Wikipedia [Daftar kecamatan dan kelurahan di Indonesia](https://id.wikipedia.org/wiki/Daftar_kecamatan_dan_kelurahan_di_Indonesia)
dipakai **hanya sebagai sanity-check jumlah**, bukan sumber produksi. Keempat
angka di atas cocok persis dengan ringkasan halaman itu.

> ### Kode kecamatan berubah dari seed lama
> Seed sebelum 2026-08-10 memakai kode gaya **BPS** untuk kecamatan (7 digit,
> mis. Enggal = `1871170`). Dataset resmi memakai **Kemendagri** (6 digit,
> Enggal = `187117`). Keduanya angka yang berbeda, bukan varian penulisan.
> Migrasi `0064_wilayah_kemendagri_codes_cleanup.sql` memetakan kode lama yang
> sudah tersimpan di `persons` / `business_entities` ke kode resmi dan membuang
> 80 baris referensi non-resmi. Seed lama juga memakai singkatan nama
> (`DKI Jakarta`); dataset resmi memakai bentuk panjang
> (`Daerah Khusus Ibukota Jakarta`).

## Status Seed

Folder ini berisi dataset **lengkap** sampai desa/kelurahan, dalam format JSON.
Import dengan `npm run db:import:wilayah` (idempotent);
`npm run db:seed:regions` adalah alias lama yang menjalankan script yang sama.

## Refresh dataset dari sumber

```bash
curl -o /tmp/wilayah.sql \
  https://raw.githubusercontent.com/cahyadsn/wilayah/master/db/wilayah.sql
node scripts/convert-wilayah-source.cjs /tmp/wilayah.sql   # → *.json di folder ini
node scripts/import-wilayah.cjs --dry-run                  # cek dulu
npm run db:import:wilayah                                  # import beneran
```

`scripts/convert-wilayah-source.cjs` memecah tabel datar `wilayah (kode, nama)`
menjadi empat level berdasarkan jumlah segmen kode, dan membuang titiknya.
Unduhan dilakukan **manual/offline**; tidak ada bagian aplikasi yang memanggil
sumber eksternal saat runtime.

## Importer

`scripts/import-wilayah.cjs` — satu-satunya importer wilayah.

```bash
npm run db:import:wilayah                  # upsert dari infra/db/seeds/regions
node scripts/import-wilayah.cjs --dry-run  # lihat dampaknya tanpa menulis
node scripts/import-wilayah.cjs --dir /path/to/dataset
node scripts/import-wilayah.cjs --prune    # HAPUS baris yang tidak ada di file
```

| Sifat | Keterangan |
|---|---|
| Format | `provinces/regencies/districts/villages` dengan ekstensi `.csv` atau `.json` (array objek). CSV menang bila keduanya ada. Dataset di folder ini sengaja **JSON**: dua nama desa resmi memuat koma (`Lubuk Pakam I,II`, `Lambang Sari I, II, III`) dan parser CSV importer memakai `split(',')` polos. |
| Idempotent | `INSERT ... ON CONFLICT (code) DO UPDATE`. Kode wilayah dipertahankan apa adanya, tidak pernah di-generate ulang. |
| Output | Jumlah `inserted` / `updated` per level. |
| Penghapusan | **Tidak pernah** menghapus, kecuali `--prune` diberikan eksplisit. |
| Jaringan | Tidak ada. Script hanya membaca file lokal — form produksi tidak boleh bergantung pada API eksternal saat runtime. |

`--prune` menghapus baris DB yang tidak ada di file sumber, anak dulu
(villages → districts → regencies → provinces). Kolom wilayah di `persons` dan
`business_entities` menyimpan code **dan** name secara denormalisasi tanpa FK,
jadi prune tidak menggagalkan baris lama — tapi kode yang sudah terlanjur
tersimpan bisa jadi tidak lagi resolvable lewat endpoint referensi. Jalankan
`--dry-run` dulu.

## Format Kode

```
Provinsi    : 2 digit           contoh: 18         (Lampung)
Kab/Kota    : 4 digit           contoh: 1871       (Kota Bandar Lampung)
Kecamatan   : 6 digit           contoh: 187117     (Enggal)
Desa/Kel    : 10 digit          contoh: 1871171001 (Kelurahan Enggal)
```

Segmen ke-4 kode desa menandai jenisnya: `1xxx` = Kelurahan, `2xxx` = Desa.

Penyusunan: kab/kota = `province_code(2) + regency_seq(2)`,
kecamatan = `regency_code(4) + district_seq(2)`,
desa/kel = `district_code(6) + village_seq(4)`.

## Catatan Kode Papua

Provinsi pemekaran 2022 memakai kode Kemendagri pasca-pemekaran:
`91` Papua, `92` Papua Barat, `93` Papua Selatan, `94` Papua Tengah,
`95` Papua Pegunungan, `96` Papua Barat Daya.

Seed lama sempat memakai `97` untuk Papua Pegunungan — kode itu tidak ada di
Kepmendagri 300.2.2-2138/2025 dan sudah dibersihkan oleh migrasi `0064`.
