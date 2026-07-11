# Region Reference Data

## Source

| Item | Detail |
|------|--------|
| Primary source | Kemendagri — Kepmendagri No. 300.2.2-2138 Tahun 2025 (atau pemutakhiran terbarunya) |
| Code system | Kode Wilayah Administrasi Kemendagri (format numerik tanpa titik, identik dengan kode BPS) |
| Provinsi | 38 provinsi (termasuk 4 provinsi pemekaran Papua 2022) |
| Kab/Kota | 514 wilayah — **lengkap** |
| Kecamatan | **Parsial** — hanya Bandar Lampung (20) dan Kota Metro (5) + DKI Jakarta test data |
| Desa/Kelurahan | **Parsial** — hanya Kec. Enggal Bandar Lampung (6) + test data |

## Status Seed

Migration `0037` meng-import semua kab/kota + kecamatan Bandar Lampung + kelurahan Enggal.
Script `npm run db:seed:regions` meng-import dari CSV di folder ini (idempotent).

## Format Kode

```
Provinsi    : 2 digit           contoh: 18 (Lampung)
Kab/Kota    : 4 digit           contoh: 1871 (Kota Bandar Lampung)
Kecamatan   : 7 digit           contoh: 1871170 (Enggal)
Desa/Kel    : 10 digit          contoh: 1871170001 (Kelurahan Enggal)
```

Format: `province_code(2) + regency_seq(2)` untuk kab/kota.
Kecamatan: `regency_code(4) + district_seq(3)`.
Desa: `district_code(7) + village_seq(3)`.

## Cara Refresh Data (Full Dataset)

Untuk production dengan semua kecamatan dan desa/kelurahan:

1. **Unduh dataset resmi:**
   - Sumber: [data.kemendagri.go.id](https://data.kemendagri.go.id) atau portal Dukcapil
   - Alternatif open data: [github.com/cahyadsn/wilayah](https://github.com/cahyadsn/wilayah) (berbasis Permendagri)
   - Format: CSV atau SQL dump

2. **Konversi ke format CSV sesuai skema ini:**
   ```
   districts.csv  : code,regency_code,name
   villages.csv   : code,district_code,name,type
   ```

3. **Jalankan seed:**
   ```bash
   npm run db:seed:regions
   ```
   Script idempotent — aman dijalankan ulang. Menggunakan `ON CONFLICT DO UPDATE`.

## Catatan Kode Papua

Kode kab/kota untuk provinsi pemekaran 2022 (92, 95, 96, 97) menggunakan kode Kemendagri
pasca-pemekaran. Verifikasi terhadap Kepmendagri terbaru dianjurkan sebelum go-live produksi.
