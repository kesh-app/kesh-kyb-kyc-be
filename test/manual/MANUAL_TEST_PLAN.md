# Manual Test Plan — KYC/KYB API PJP-3

**Base URL:** `http://localhost:4000/api`  
**Prefix global:** `/api`  
**Auth:** Bearer token dari `POST /api/auth/login`

**Seed users (dari `npm run db:seed`):**
| Email | Password | Role |
|-------|----------|------|
| `admin@example.com` | `Admin123!` | ComplianceLead |
| `sysadmin@kesh.local` | `SystemAdmin@123` | SystemAdmin |

**Roles yang bisa akses:**
- `BranchAdmin`, `ComplianceReviewer`, `ComplianceLead` → operations aplikasi
- `ComplianceReviewer`, `ComplianceLead` → submit, decision, watchlist upload
- `FinanceStaff` → buat & submit transfer
- `FinanceManager` → approve/reject transfer, set result
- `SystemAdmin` → user management (selalu diizinkan semua endpoint)

---

## A. Auth

### A-01 — Login valid
| Field | Value |
|-------|-------|
| **Tujuan** | Login dengan credentials valid menghasilkan JWT |
| **Precondition** | `npm run db:seed` sudah dijalankan |
| **Method** | `POST` |
| **Endpoint** | `/auth/login` |
| **Body** | `{"email":"admin@example.com","password":"Admin123!"}` |
| **Expected HTTP** | `201` |
| **Expected Body** | `access_token` (string), `user.role = "ComplianceLead"` |

### A-02 — Login password salah
| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Endpoint** | `/auth/login` |
| **Body** | `{"email":"admin@example.com","password":"WrongPass!"}` |
| **Expected HTTP** | `401` |

### A-03 — Login email tidak ada
| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Endpoint** | `/auth/login` |
| **Body** | `{"email":"ghost@example.com","password":"Any123!"}` |
| **Expected HTTP** | `401` |

### A-04 — GET /auth/me dengan token
| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Endpoint** | `/auth/me` |
| **Headers** | `Authorization: Bearer <token>` |
| **Expected HTTP** | `200` |
| **Expected Body** | `{id, name, email, role, last_login_at}` |

### A-05 — GET /auth/me tanpa token
| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Endpoint** | `/auth/me` |
| **Expected HTTP** | `401` |

---

## B. KYC Individual — Happy Path

### B-01 — Create individual returns DRAFT
| Field | Value |
|-------|-------|
| **Tujuan** | Aplikasi baru selalu DRAFT, tidak pernah auto-APPROVED |
| **Precondition** | Token ComplianceLead |
| **Method** | `POST` |
| **Endpoint** | `/applications/individual` |
| **Body** | `{"full_name":"Budi Santoso","identity_type":"KTP","identity_number":"3175001234567890","address_identity":"Jl. Contoh No.1","pob":"Jakarta","dob":"1990-01-15","nationality":"ID","phone":"081234567890","occupation":"Karyawan","gender":"M","signature_uri":"https://storage/sig.png"}` |
| **Expected HTTP** | `201` |
| **Expected Body** | `status = "DRAFT"`, `id` (number) |
| **SQL Validasi** | `SELECT id, status FROM applications WHERE id = <id>;` |

### B-02 — Tambah dokumen KTP
| Field | Value |
|-------|-------|
| **Precondition** | `APPLICATION_ID` dari B-01 |
| **Method** | `POST` |
| **Endpoint** | `/applications/:id/documents` |
| **Body** | `{"doc_type":"KTP","file_uri":"https://storage/ktp.jpg"}` |
| **Expected HTTP** | `201` |
| **Expected Body** | `{id, doc_type:"KTP", status:"PENDING", application_id}` |

### B-03 — Precheck setelah sig + doc → ok
| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Endpoint** | `/applications/:id/precheck` |
| **Expected HTTP** | `200` |
| **Expected Body** | `{"ok": true}` |

### B-04 — Submit individual → SUBMITTED + risk
| Field | Value |
|-------|-------|
| **Tujuan** | Submit menjalankan screening + risk scoring otomatis |
| **Precondition** | App DRAFT + ada sig + ada KTP doc |
| **Method** | `PATCH` |
| **Endpoint** | `/applications/:id/submit` |
| **Body** | *(kosong)* |
| **Expected HTTP** | `200` |
| **Expected Body** | `{status:"SUBMITTED", risk:{risk_score, risk_level, factors}}` |
| **SQL Validasi** | `SELECT * FROM application_risk WHERE application_id = <id>;` |

### B-05 — GET /screening setelah submit
| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Endpoint** | `/applications/:id/screening` |
| **Expected HTTP** | `200` |
| **Expected Body** | `{results: [...], risk: {application_id, risk_score, risk_level, ...}}` |
| **Catatan** | `risk` berasal dari `application_risk`, **bukan** `risk_profiles` |

### B-06 — Decision APPROVE
| Field | Value |
|-------|-------|
| **Precondition** | App SUBMITTED, tidak ada CONFIRMED DTTOT/PPPSPM hit |
| **Method** | `PATCH` |
| **Endpoint** | `/applications/:id/decision` |
| **Body** | `{"decision":"APPROVED","reason":"Semua dokumen valid"}` |
| **Expected HTTP** | `200` |
| **Expected Body** | `{id, status:"APPROVED", decision_reason, decision_at}` |

### B-07 — Decision REJECTED
| Field | Value |
|-------|-------|
| **Method** | `PATCH` |
| **Endpoint** | `/applications/:id/decision` |
| **Body** | `{"decision":"REJECTED","reason":"Dokumen palsu"}` |
| **Expected HTTP** | `200` |
| **Expected Body** | `{status:"REJECTED", decision_reason:"Dokumen palsu"}` |

---

## C. KYC Individual — Validation Failures

### C-01 — Submit tanpa sig dan doc → 400 missing keduanya
| Field | Value |
|-------|-------|
| **Precondition** | Individual app DRAFT, belum ada sig/doc |
| **Method** | `PATCH` |
| **Endpoint** | `/applications/:id/submit` |
| **Expected HTTP** | `400` |
| **Expected Body** | `{message:"INDIVIDUAL belum lengkap untuk submit", missing:["signature_uri (tanda tangan)","dokumen identitas (KTP/SIM/PASPOR)"]}` |

### C-02 — Submit tanpa sig saja → 400 missing sig
| Field | Value |
|-------|-------|
| **Precondition** | Ada KTP doc tapi person.signature_uri = NULL |
| **Method** | `PATCH` |
| **Endpoint** | `/applications/:id/submit` |
| **Expected HTTP** | `400` |
| **Expected Body** | `missing` berisi `"signature_uri"` |

### C-03 — Submit tanpa doc saja → 400 missing doc
| Field | Value |
|-------|-------|
| **Precondition** | signature_uri ada di person, tapi belum ada KTP/SIM/PASPOR doc |
| **Expected HTTP** | `400` |
| **Expected Body** | `missing` berisi `"dokumen identitas"` |

### C-04 — GET precheck incomplete → 400
| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Endpoint** | `/applications/:id/precheck` |
| **Expected HTTP** | `400` |
| **Expected Body** | `{missing: [...]}` |

---

## D. KYB Business — Happy Path

### D-01 — Create business → DRAFT
| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Endpoint** | `/applications/business` |
| **Body** | `{"legal_name":"PT Test","legal_form":"PT","incorporation_place":"Jakarta","incorporation_date":"2020-01-01","business_license_number":"BL001","nib":"12345678901234567","npwp":"123456789012345","address_line":"Jl. Bisnis No.5","city":"Jakarta","province":"DKI Jakarta","postal_code":"12345","business_activity":"Perdagangan Umum","phone":"02112345678"}` |
| **Expected HTTP** | `201` |
| **Expected Body** | `{id, status:"DRAFT"}` |

### D-02 — Add DIRECTOR party
| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Endpoint** | `/applications/:id/parties` |
| **Body** | `{"role":"DIRECTOR","full_name":"Budi Direktur","identity_type":"KTP","identity_number":"3276001234567890","dob":"1975-09-01","nationality":"ID","phone":"081987654321"}` |
| **Expected HTTP** | `201` |
| **Expected Body** | `{id, role:"DIRECTOR", is_active:true}` |
| **SQL Validasi** | `SELECT * FROM business_parties WHERE business_id = (SELECT business_id FROM applications WHERE id = <id>);` |

### D-03 — Add 3 dokumen korporasi wajib
| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Endpoint** | `/applications/:id/documents` (3x) |
| **Body 1** | `{"doc_type":"AKTA_PENDIRIAN","file_uri":"..."}` |
| **Body 2** | `{"doc_type":"NIB_SIUP","file_uri":"..."}` |
| **Body 3** | `{"doc_type":"NPWP_BADAN","file_uri":"..."}` |
| **Expected HTTP** | `201` each |

### D-04 — Submit bisnis (docs + party) → SUBMITTED
| Field | Value |
|-------|-------|
| **Method** | `PATCH` |
| **Endpoint** | `/applications/:id/submit` |
| **Expected HTTP** | `200` |
| **Expected Body** | `{status:"SUBMITTED", risk:{...}}` |

### D-05 — Decision APPROVE bisnis
| Field | Value |
|-------|-------|
| **Method** | `PATCH` |
| **Endpoint** | `/applications/:id/decision` |
| **Body** | `{"decision":"APPROVED"}` |
| **Expected HTTP** | `200` |
| **Expected Body** | `{status:"APPROVED"}` |

---

## E. KYB Business — Validation Failures

### E-01 — Submit tanpa docs dan party → 400 missing keduanya
| Field | Value |
|-------|-------|
| **Precondition** | BUSINESS app baru, tidak ada docs/party |
| **Expected HTTP** | `400` |
| **Expected Body** | `missing` berisi `"dokumen korporasi"` DAN `"party"` |

### E-02 — Submit tanpa salah satu doc korporasi
| Field | Value |
|-------|-------|
| **Precondition** | Ada AKTA + NIB tapi tidak ada NPWP_BADAN |
| **Expected HTTP** | `400` |
| **Expected Body** | `missing` berisi `"NPWP_BADAN"` |

### E-03 — Submit dengan docs tapi tanpa party
| Field | Value |
|-------|-------|
| **Precondition** | Semua 3 docs ada tapi business_parties kosong |
| **Expected HTTP** | `400` |
| **Expected Body** | `missing` berisi `"minimal 1 party"` |

---

## F. Watchlist Upload

### F-01 — Upload xlsx valid (PEP)
| Field | Value |
|-------|-------|
| **Tujuan** | Upload file watchlist PEP |
| **Precondition** | Token ComplianceReviewer/ComplianceLead, file PEP.xlsx dengan header yang benar |
| **Method** | `POST` |
| **Endpoint** | `/watchlist/upload` |
| **Body** | `multipart/form-data`: `file=@PEP.xlsx`, `list_type=PEP`, `list_source=PPATK` |
| **Expected HTTP** | `201` |
| **Expected Body** | `{ok:true, total:N, success:N, errors:null}` |
| **SQL Validasi** | `SELECT COUNT(*) FROM watchlist_entries WHERE list_type='PEP';` |
| **SQL Validasi** | `SELECT * FROM watchlist_ingest_logs ORDER BY created_at DESC LIMIT 1;` |

### F-02 — Upload DTTOT
| Field | Value |
|-------|-------|
| **Body** | `multipart/form-data`: `file=@DTTOT.xlsx`, `list_type=DTTOT`, `list_source=BNPT` |
| **Expected HTTP** | `201` |

### F-03 — Upload file bukan xlsx → 400
| Field | Value |
|-------|-------|
| **Body** | `multipart/form-data`: `file=@dokumen.txt`, `list_type=PEP`, `list_source=TEST` |
| **Expected HTTP** | `400` |
| **Expected Body** | `message` berisi `"Only .xlsx/.xls/.csv allowed"` |

### F-04 — Upload tanpa file → 400
| Field | Value |
|-------|-------|
| **Body** | `multipart/form-data`: hanya `list_type`, tanpa `file` |
| **Expected HTTP** | `400` |

### F-05 — GET /watchlist/history
| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Endpoint** | `/watchlist/history?limit=10` |
| **Expected HTTP** | `200` |
| **Expected Body** | Array log: `[{id, list_type, list_source, total_rows, success_rows, error_message, uploaded_by}]` |

### F-06 — Upload dengan role FinanceStaff → 403
| Field | Value |
|-------|-------|
| **Precondition** | Token FinanceStaff |
| **Expected HTTP** | `403` |

---

## G. Screening & Risk Score

### G-01 — Screening result setelah submit
| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Endpoint** | `/applications/:id/screening` |
| **Expected HTTP** | `200` |
| **Expected Body** | `{results:[...], risk:{application_id, risk_score, risk_level, factors, ...}}` |
| **SQL Validasi** | `SELECT * FROM screening_results WHERE application_id = <id> ORDER BY score DESC;` |
| **SQL Validasi** | `SELECT * FROM application_risk WHERE application_id = <id>;` |

### G-02 — Risk level valid
| Field | Value |
|-------|-------|
| **Tujuan** | Verifikasi risk_level dari application_risk, bukan risk_profiles (sudah deprecated) |
| **SQL Validasi** | `SELECT risk_level FROM application_risk WHERE application_id = <id>;` — harus LOW/MEDIUM/HIGH |
| **Catatan** | `SELECT * FROM risk_profiles WHERE ...` → TIDAK BOLEH dipakai lagi |

---

## H. Decision Blocked — CONFIRMED DTTOT/PPPSPM

### H-01 — Approve diblokir jika ada CONFIRMED DTTOT hit
| Field | Value |
|-------|-------|
| **Tujuan** | Applicant dengan DTTOT CONFIRMED tidak boleh di-APPROVE |
| **Precondition** | App SUBMITTED, ada row di screening_results dengan review_status='CONFIRMED' dan list_type='DTTOT' |
| **SQL Setup** | `UPDATE screening_results SET review_status='CONFIRMED' WHERE application_id=<id> AND list_type='DTTOT' LIMIT 1;` |
| **Method** | `PATCH` |
| **Endpoint** | `/applications/:id/decision` |
| **Body** | `{"decision":"APPROVED"}` |
| **Expected HTTP** | `400` |
| **Expected Body** | `message` berisi `"CONFIRMED DTTOT"` |

### H-02 — REJECT tetap bisa meski ada CONFIRMED DTTOT
| Field | Value |
|-------|-------|
| **Precondition** | Sama seperti H-01 |
| **Body** | `{"decision":"REJECTED","reason":"Teridentifikasi DTTOT"}` |
| **Expected HTTP** | `200` |
| **Expected Body** | `{status:"REJECTED"}` |

---

## I. Dashboard & Summary

### I-01 — Dashboard summary
| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Endpoint** | `/kyc/dashboard-summary` |
| **Expected HTTP** | `200` |
| **Expected Body** | `{totals:{total, status:{DRAFT:N, SUBMITTED:N, ...}, risk:{LOW:N, MEDIUM:N, HIGH:N}}, recent:[...]}` |
| **Catatan** | `risk_level` di `recent` berasal dari `application_risk` (COALESCE override_level, risk_level) |

### I-02 — /kyc/submissions (backward compat)
| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Endpoint** | `/kyc/submissions?limit=5` |
| **Expected HTTP** | `200` |
| **Expected Body** | Array, sama struktur dengan `recent` di dashboard |

---

## J. Registrants List

### J-01 — List INDIVIDUAL
| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Endpoint** | `/kyc/registrants?type=INDIVIDUAL` |
| **Expected HTTP** | `200` |
| **Expected Body** | `{total, limit, offset, items:[{application_id, type, status, display_name, email, phone, risk_level, risk_score}]}` |

### J-02 — List BUSINESS
| Field | Value |
|-------|-------|
| **Endpoint** | `/kyc/registrants?type=BUSINESS` |
| **Expected Body** | items dengan `nib`, `npwp` (bukan email/phone) |

### J-03 — Filter by status
| Field | Value |
|-------|-------|
| **Endpoint** | `/kyc/registrants?status=APPROVED` |
| **Expected Body** | Semua items.status = "APPROVED" |

### J-04 — Search query
| Field | Value |
|-------|-------|
| **Endpoint** | `/kyc/registrants?type=INDIVIDUAL&q=Budi` |
| **Expected Body** | items yang `display_name` atau `email` mengandung "Budi" |

---

## K. Transfers

### K-01 — Create transfer sender belum APPROVED → 400
| Field | Value |
|-------|-------|
| **Precondition** | Token FinanceStaff, `sender_application_id` → aplikasi DRAFT/SUBMITTED |
| **Method** | `POST` |
| **Endpoint** | `/transfers` |
| **Body** | `{"amount":500000,"sender_application_id":<draft_id>,"beneficiaryBankName":"Bank Test","beneficiaryAccountNumber":"1234567890","beneficiaryAccountName":"Penerima Test"}` |
| **Expected HTTP** | `400` |
| **Expected Body** | `message:"Sender is not KYC/KYB approved"` |

### K-02 — Create transfer sender APPROVED → 201 DRAFT
| Field | Value |
|-------|-------|
| **Precondition** | `sender_application_id` → aplikasi APPROVED |
| **Method** | `POST` |
| **Endpoint** | `/transfers` |
| **Body** | `{"amount":1000000,"sender_application_id":<approved_id>,"beneficiaryBankName":"Bank Mandiri","beneficiaryAccountNumber":"9876543210","beneficiaryAccountName":"PT Penerima"}` |
| **Expected HTTP** | `201` |
| **Expected Body** | `{id, status:"DRAFT", amount:1000000}` |

### K-03 — Submit transfer → SUBMITTED
| Field | Value |
|-------|-------|
| **Precondition** | Token FinanceStaff, transfer DRAFT |
| **Method** | `POST` |
| **Endpoint** | `/transfers/:id/submit` |
| **Expected HTTP** | `201` |
| **Expected Body** | `{status:"SUBMITTED"}` |

### K-04 — Decision APPROVE transfer → APPROVED
| Field | Value |
|-------|-------|
| **Precondition** | Token FinanceManager, transfer SUBMITTED |
| **Method** | `POST` |
| **Endpoint** | `/transfers/:id/decision` |
| **Body** | `{"decision":"APPROVE","note":"Disetujui"}` |
| **Expected HTTP** | `201` |
| **Expected Body** | `{status:"APPROVED"}` |

### K-05 — Set result SUCCESS → COMPLETED
| Field | Value |
|-------|-------|
| **Precondition** | Token FinanceManager, transfer APPROVED |
| **Method** | `POST` |
| **Endpoint** | `/transfers/:id/result` |
| **Body** | `{"result":"SUCCESS","note":"Transfer berhasil"}` |
| **Expected HTTP** | `201` |
| **Expected Body** | `{status:"COMPLETED", result:"SUCCESS"}` |

### K-06 — Transfer dengan role ComplianceLead → 403
| Field | Value |
|-------|-------|
| **Precondition** | Token ComplianceLead |
| **Expected HTTP** | `403` |

---

## L. Negative / Invalid Status Transitions

### L-01 — Decision pada app DRAFT → 400
| Field | Value |
|-------|-------|
| **Precondition** | App status = DRAFT |
| **Method** | `PATCH` |
| **Endpoint** | `/applications/:id/decision` |
| **Body** | `{"decision":"APPROVED"}` |
| **Expected HTTP** | `400` |
| **Expected Body** | `message` berisi `"DRAFT"` |

### L-02 — Decision pada app APPROVED (sudah final) → 400
| Field | Value |
|-------|-------|
| **Expected HTTP** | `400` |
| **Expected Body** | `message` berisi `"APPROVED"` |

### L-03 — Submit transfer yang bukan DRAFT → 400
| Field | Value |
|-------|-------|
| **Precondition** | Transfer sudah SUBMITTED/APPROVED |
| **Method** | `POST` |
| **Endpoint** | `/transfers/:id/submit` |
| **Expected HTTP** | `400` |
| **Expected Body** | `message:"Only DRAFT can be submitted"` |

### L-04 — FinanceStaff mencoba approve transfer → 403
| Field | Value |
|-------|-------|
| **Precondition** | Token FinanceStaff |
| **Method** | `POST` |
| **Endpoint** | `/transfers/:id/decision` |
| **Expected HTTP** | `403` |

---

## M. Regression — Tidak Boleh Query risk_profiles

### M-01 — Dashboard summary tidak menggunakan risk_profiles
| Field | Value |
|-------|-------|
| **Tujuan** | Verifikasi kode dashboard.controller.ts hanya JOIN ke `application_risk` |
| **Test** | Inspeksi source: `src/modules/dashboard/dashboard.controller.ts` |
| **Expected** | Tidak ada string `risk_profiles` dalam file tersebut |
| **SQL Check** | `SELECT COUNT(*) FROM risk_profiles;` → tidak dipakai tapi tabel mungkin masih ada |

### M-02 — Registrants tidak menggunakan risk_profiles
| Field | Value |
|-------|-------|
| **Test** | Inspeksi source: `src/modules/registrants/registrants.controller.ts` |
| **Expected** | Tidak ada `risk_profiles` dalam JOIN, hanya `application_risk` |

### M-03 — Screening endpoint menggunakan application_risk
| Field | Value |
|-------|-------|
| **Test** | Inspeksi source: `src/modules/applications/applications.controller.ts` method `screening()` |
| **SQL Check** | `SELECT * FROM application_risk WHERE application_id = <submitted_id>;` → ada row |

---

## SQL Validation Queries

Jalankan setelah `npm run db:migrate` dan setelah test flows diatas:

```sql
-- Cek semua tabel yang ada
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Cek migration history
SELECT filename, applied_at
FROM schema_migrations
ORDER BY applied_at;

-- Cek aplikasi terbaru
SELECT id, type, status, created_at
FROM applications
ORDER BY created_at DESC
LIMIT 10;

-- Cek risk (harus dari application_risk, bukan risk_profiles)
SELECT a.id, a.status, ar.risk_level, ar.risk_score
FROM applications a
LEFT JOIN application_risk ar ON ar.application_id = a.id
ORDER BY a.created_at DESC
LIMIT 10;

-- Cek screening results
SELECT sr.application_id, sr.subject_type, sr.list_type, sr.score, sr.review_status
FROM screening_results sr
ORDER BY sr.created_at DESC
LIMIT 20;

-- Cek watchlist ingest log (actor_id bisa NULL — tidak ada FK ke users)
SELECT id, created_at, list_type, list_source, total_rows, success_rows, error_message
FROM watchlist_ingest_logs
ORDER BY created_at DESC
LIMIT 5;

-- Cek business_parties (bukan business_roles)
SELECT bp.id, bp.role, bp.is_active, p.full_name
FROM business_parties bp
JOIN persons p ON p.id = bp.person_id
ORDER BY bp.created_at DESC
LIMIT 10;

-- Cek transfer flow
SELECT id, status, amount, created_at
FROM transfers
ORDER BY id DESC
LIMIT 5;
```
