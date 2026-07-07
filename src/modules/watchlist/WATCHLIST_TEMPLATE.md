# Watchlist Upload — Template Note

Endpoint: `POST /api/watchlist/upload` (role: **ComplianceLead**).
Format file: `.xlsx` / `.xls` / `.csv`. Header kolom memakai PascalCase + underscore
(mis. `Unique_ID`, `Full_Name`, `Entity_Name`, `Date_of_Birth`, `Nationality`,
`National_ID_Number`, `Sanction_Number`, `Source_URL`, dst).

## list_type (field upload, wajib)

`list_type` (form field saat upload) menerima: **`PEP`**, **`DTTOT`**, **`PPPSPM`**.
Ini adalah tipe upload utama dan divalidasi DTO + CHECK constraint DB
(`watchlist_entries_list_type_check`). **Tidak** menerima `OTHER`.

> Beda dengan kolom per-baris `watchlist_type` (v3): kolom itu boleh `OTHER` sebagai
> fallback klasifikasi baris. `list_type` upthread selalu salah satu PEP/DTTOT/PPPSPM.

## Unique_ID (opsional)

- **Kolom `Unique_ID` tetap didukung.**
- Jika `Unique_ID` **diisi**, sistem memakai value dari file apa adanya.
- Jika `Unique_ID` **kosong/null/blank**, sistem **auto-generate** secara otomatis
  (frontend tidak perlu membuat Unique_ID).
- ID auto-generate bersifat **deterministik** (bukan random): baris yang sama
  di-upload ulang akan menghasilkan ID yang sama sehingga **tidak menjadi duplikat**.

### Format ID auto-generate

```
KESH-WL-AUTO-<16 hex uppercase>
contoh: KESH-WL-AUTO-8F3A91C2D4B7E102
```

Sumber hash (dinormalisasi: trim → uppercase → string kosong bila null → join `"|"`):
`Full_Name`, `Entity_Name`, `Date_of_Birth`, `Nationality`, `National_ID_Number`,
`Sanction_Number`, `Source_URL`.

## Validasi

- Setiap baris **wajib** punya minimal salah satu dari `Full_Name` atau `Entity_Name`.
  Baris tanpa keduanya ditolak (tidak berguna untuk screening dan membuat auto-generate
  unique_id kehilangan makna).
- Upsert/dedup memakai `upper(unique_id)` lebih dulu, lalu fallback ke natural key
  (`list_type` + `list_source` + nama + `Date_of_Birth`). Unique_ID eksplisit yang sudah
  ada tidak akan tertimpa oleh ID auto-generate.

## Watchlist Template v3 (kolom opsional tambahan)

Semua kolom v3 **opsional** dan hanya untuk **audit / traceability / persiapan
screening ke depan** — belum dipakai untuk matching. Matching tetap berbasis
`name_norm` / `aliases_concat` / tanggal / national id seperti sebelumnya.

Header **case/spasi/underscore-insensitive**, dan menerima alias friendly + Bahasa
Indonesia:

| Kolom (DB)          | Header yang diterima                                   |
| ------------------- | ------------------------------------------------------ |
| `watchlist_type`    | `Watchlist_Type` · `Watchlist Type` · `Jenis Watchlist`|
| `subject_type`      | `Subject_Type` · `Subject Type` · `Terduga` · `Jenis Subjek` |
| `raw_date_of_birth` | `Raw_Date_of_Birth` · `Raw Date of Birth` · `Tanggal Lahir Mentah` |
| `place_of_birth`    | `Place_of_Birth` · `Place of Birth` · `Tempat Lahir`   |
| `position_title`    | `Position_Title` · `Position Title` · `Jabatan`        |
| `institution_name`  | `Institution_Name` · `Institution Name` · `Instansi`   |
| `address`           | `Address` · `Alamat`                                   |
| `description`       | `Description` · `Deskripsi`                             |

### Normalisasi nilai

- **`Watchlist_Type`** → uppercase salah satu `DTTOT` / `PEP` / `PPPSPM` / `OTHER`.
  Bila kosong, di-infer dari `list_type` upload (fallback scan `list_source`, lalu `OTHER`).
  Nilai non-standar → `OTHER`.
- **`Subject_Type`** → `PERSON` / `ENTITY`. Menerima Bahasa Indonesia:
  `Orang` → `PERSON`; `Korporasi` / `Perusahaan` / `Badan` → `ENTITY`.
  Kosong / tak dikenal → dibiarkan kosong.

### Catatan per jenis list

- **DTTOT (PPATK):** isi `Subject_Type` (Orang/Korporasi), `Tempat Lahir`,
  `Alamat`, `Tanggal Lahir Mentah` (DOB mentah bila format tidak baku), dan `Deskripsi`.
- **PEP:** isi `Jabatan` (`Position_Title`) dan `Instansi` (`Institution_Name`).

### Kolom v2 yang tetap didukung

`Unique_ID`, `Full_Name`, `Alias_Name`, `Date_of_Birth`, `Nationality`,
`National_ID_Number`, `Entity_Name`, `Sanction_Number`, `Source_URL`, `Remarks`.

## Policy `Watchlist_Type` vs Jenis List yang dipilih

`Watchlist_Type` per-baris **harus cocok** dengan `list_type` (Jenis List) yang dipilih
saat upload:

- **Cocok / kosong** → baris diproses. (Kosong di-infer ke `list_type` terpilih.)
- **Mismatch** (mis. pilih `PEP` tapi baris `DTTOT`/`PPPSPM`) → **error per-baris** yang
  jelas: _"Watchlist_Type (X) tidak cocok dengan Jenis List yang dipilih (Y)."_
  Baris **tidak** disimpan dan **tidak** di-relabel diam-diam.

Jadi upload file campuran tidak pernah "silent skip": setiap baris yang gagal muncul
di `row_errors`.

## Encoding & BOM

File CSV UTF-8 dengan **BOM (UTF-8-SIG)** didukung. BOM dibuang dari buffer dan dari
header sebelum parsing, sehingga header pertama (mis. `Unique_ID`) tetap terbaca benar.

## Bentuk response `POST /watchlist/upload`

```jsonc
{
  "ok": true,            // false bila success = 0 (tidak menampilkan sukses palsu)
  "status": "SUCCESS",   // SUCCESS | PARTIAL | FAILED
  "total": 3,            // jumlah baris data
  "success": 1,          // baris berhasil diproses
  "error_count": 2,      // jumlah baris gagal
  "errors": "Baris 2: ...; Baris 4: ...",   // ringkasan gabungan (null bila tak ada)
  "row_errors": [        // detail per-baris
    { "row": 2, "message": "Watchlist_Type (DTTOT) tidak cocok ..." },
    { "row": 4, "message": "Watchlist_Type (PPPSPM) tidak cocok ..." }
  ],
  "log": { "uploaded_by": "1" }
}
```

`status` = `FAILED` bila `success = 0`, `PARTIAL` bila sebagian gagal, `SUCCESS` bila semua baris masuk.

## Read endpoints (RBAC: ComplianceLead + SystemAdmin; FrontDesk/Auditor/Finance diblokir)

### `GET /watchlist/entries` — data watchlist yang tersimpan

Query params: `page` (default 1), `limit` (default 20, max 100), `list_type`,
`source_list`, `watchlist_type`, `subject_type`, `q`.

`q` mencari di: `unique_id`, `full_name`, `name`, `entity_name`, alias (`aliases_concat`),
`national_id_number`, `sanction_number`, `position_title`, `institution_name`.

```jsonc
{
  "data": [ { "id": "1", "unique_id": "...", "list_type": "PEP", "source_list": "BNPT",
              "watchlist_type": "PEP", "subject_type": "PERSON", "full_name": "...",
              "alias_name": "...", "entity_name": null, "date_of_birth": "...",
              "raw_date_of_birth": null, "place_of_birth": null, "nationality": "ID",
              "national_id_number": "...", "position_title": "...", "institution_name": "...",
              "address": null, "sanction_number": null, "source_url": null,
              "description": null, "remarks": null, "created_at": "...", "updated_at": "..." } ],
  "page": 1, "limit": 20, "total": 100
}
```

> Catatan relasi: `watchlist_entries` **tidak** punya kolom `upload_log_id`/`ingest_log_id`
> ke `watchlist_ingest_logs`. Untuk data existing, cara paling aman memfilter entries per
> upload adalah lewat `list_type` + `source_list`. Endpoint `/uploads/:id/entries` tidak
> disediakan karena relasi tsb belum ada (tidak dipaksakan pada data lama).

### `GET /watchlist/history` — riwayat upload (paginated)

Query params: `page` (default 1), `limit` (default 20, max 100), `list_type`,
`source_list`, `status` (`SUCCESS`/`PARTIAL`/`FAILED`). `status` dihitung dari
`total_rows`/`success_rows` sehingga count & pagination konsisten dengan filter.

```jsonc
{
  "data": [ { "id": "1", "list_type": "PEP", "source_list": "BNPT",
              "uploaded_at": "...", "uploaded_by": "...",
              "total": 100, "success": 98, "error_count": 2, "status": "PARTIAL",
              "original_filename": "...", "error_message": "..." } ],
  "page": 1, "limit": 20, "total": 123
}
```

Field `total`/`success`/`error_count` mengisi kolom "Jumlah" di FE.

> ⚠️ **Breaking change (pagination history):** sebelumnya `GET /watchlist/history`
> mengembalikan **array langsung**; sekarang mengembalikan objek
> `{ data, page, limit, total }`. FE/report yang membaca array harus dipindah ke
> `response.data`. Item di dalam `data` **tidak berubah** (field names sama:
> `uploaded_at`, `source_list`, `total`, `success`, `error_count`, `status`, dst),
> jadi hanya perlu menyesuaikan ke `response.data`.
