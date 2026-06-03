#!/usr/bin/env bash
# ================================================================
# KYC/KYB API — cURL Manual Test Collection
# ================================================================
# Prasyarat: curl + jq terinstal
# Cara pakai:
#   Jalankan satu per satu, atau source seluruh file
#   (kecuali yang multipart file upload — jalankan manual)
# ================================================================

set -euo pipefail

BASE_URL="http://localhost:4000/api"

# ──────────────────────────────────────────────────
# SECTION A: AUTH
# ──────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "A-01: Login ComplianceLead"
echo "═══════════════════════════════════════════"
RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin123!"}')
echo "$RESPONSE" | jq .
TOKEN=$(echo "$RESPONSE" | jq -r '.access_token')
echo "→ TOKEN saved"

echo ""
echo "A-02: Login password salah (expect 401)"
curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"SalahPassword!"}' | jq .

echo ""
echo "A-03: GET /auth/me (expect 200 + user info)"
curl -s "$BASE_URL/auth/me" \
  -H "Authorization: Bearer $TOKEN" | jq .

echo ""
echo "A-04: GET /auth/me tanpa token (expect 401)"
curl -s -o /dev/null -w "HTTP %{http_code}\n" "$BASE_URL/auth/me"

# ──────────────────────────────────────────────────
# SECTION B: INDIVIDUAL CREATE → DRAFT
# ──────────────────────────────────────────────────

TS=$(date +%s | tail -c 7)

echo ""
echo "═══════════════════════════════════════════"
echo "B-01: Create INDIVIDUAL (tanpa sig) → 201 DRAFT"
echo "═══════════════════════════════════════════"
INDIV_RES=$(curl -s -X POST "$BASE_URL/applications/individual" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"full_name\": \"Test Individu $TS\",
    \"identity_type\": \"KTP\",
    \"identity_number\": \"3175000$TS\",
    \"address_identity\": \"Jl. Test No. 1, Jakarta\",
    \"pob\": \"Jakarta\",
    \"dob\": \"1990-01-15\",
    \"nationality\": \"ID\",
    \"phone\": \"0812$TS\",
    \"occupation\": \"Software Engineer\",
    \"gender\": \"M\"
  }")
echo "$INDIV_RES" | jq .
APPLICATION_ID=$(echo "$INDIV_RES" | jq -r '.id')
echo "→ APPLICATION_ID=$APPLICATION_ID"

echo ""
echo "B-02: GET /applications/:id"
curl -s "$BASE_URL/applications/$APPLICATION_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.application | {id, type, status}'

echo ""
echo "B-03: GET /applications (list)"
curl -s "$BASE_URL/applications?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq 'length'

# ──────────────────────────────────────────────────
# SECTION C: SUBMIT FAILS — MISSING DOCS
# ──────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "C-01: Submit tanpa sig & doc → 400 missing"
echo "═══════════════════════════════════════════"
curl -s -X PATCH "$BASE_URL/applications/$APPLICATION_ID/submit" \
  -H "Authorization: Bearer $TOKEN" | jq .

echo ""
echo "C-02: Precheck tanpa sig & doc → 400"
curl -s "$BASE_URL/applications/$APPLICATION_ID/precheck" \
  -H "Authorization: Bearer $TOKEN" | jq .

# ──────────────────────────────────────────────────
# SECTION D: INDIVIDUAL HAPPY PATH
# ──────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "D-01: Create INDIVIDUAL dengan signature_uri → 201 DRAFT"
echo "═══════════════════════════════════════════"
INDIV_OK_RES=$(curl -s -X POST "$BASE_URL/applications/individual" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"full_name\": \"Individu OK $TS\",
    \"identity_type\": \"KTP\",
    \"identity_number\": \"3176000$TS\",
    \"address_identity\": \"Jl. Merdeka No. 10, Bandung\",
    \"pob\": \"Bandung\",
    \"dob\": \"1985-06-20\",
    \"nationality\": \"ID\",
    \"phone\": \"0813$TS\",
    \"occupation\": \"Karyawan Swasta\",
    \"gender\": \"F\",
    \"email\": \"ok$TS@test.com\",
    \"signature_uri\": \"https://storage.test/sig.png\"
  }")
echo "$INDIV_OK_RES" | jq .
APP_OK_ID=$(echo "$INDIV_OK_RES" | jq -r '.id')
echo "→ APP_OK_ID=$APP_OK_ID"

echo ""
echo "D-02: Add KTP document → 201"
curl -s -X POST "$BASE_URL/applications/$APP_OK_ID/documents" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "doc_type": "KTP",
    "file_uri": "https://storage.test/docs/ktp.jpg"
  }' | jq '{id, doc_type, status}'

echo ""
echo "D-03: Precheck setelah sig + doc → 200 ok:true"
curl -s "$BASE_URL/applications/$APP_OK_ID/precheck" \
  -H "Authorization: Bearer $TOKEN" | jq .

echo ""
echo "D-04: PATCH /submit → 200 SUBMITTED + risk"
SUBMIT_RES=$(curl -s -X PATCH "$BASE_URL/applications/$APP_OK_ID/submit" \
  -H "Authorization: Bearer $TOKEN")
echo "$SUBMIT_RES" | jq .

echo ""
echo "D-05: GET /screening → 200 (results + risk dari application_risk)"
curl -s "$BASE_URL/applications/$APP_OK_ID/screening" \
  -H "Authorization: Bearer $TOKEN" | jq '{
    result_count: (.results | length),
    risk_level: .risk.risk_level,
    risk_score: .risk.risk_score
  }'

# ──────────────────────────────────────────────────
# SECTION E: DECISION
# ──────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "E-01: Decision APPROVE pada app DRAFT → 400"
echo "═══════════════════════════════════════════"
curl -s -X PATCH "$BASE_URL/applications/$APPLICATION_ID/decision" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"decision":"APPROVED"}' | jq '{statusCode, message}'

echo ""
echo "E-02: Decision APPROVE pada SUBMITTED → 200 APPROVED"
curl -s -X PATCH "$BASE_URL/applications/$APP_OK_ID/decision" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"decision":"APPROVED","reason":"Semua dokumen valid"}' | jq .

# ──────────────────────────────────────────────────
# SECTION F: KYB BUSINESS
# ──────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "F-01: Create BUSINESS application → 201 DRAFT"
echo "═══════════════════════════════════════════"
BIZ_RES=$(curl -s -X POST "$BASE_URL/applications/business" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"legal_name\": \"PT Test Bisnis $TS\",
    \"legal_form\": \"PT\",
    \"incorporation_place\": \"Jakarta\",
    \"incorporation_date\": \"2020-01-01\",
    \"business_license_number\": \"BL$TS\",
    \"nib\": \"NIB$TS\",
    \"npwp\": \"NPWP$TS\",
    \"address_line\": \"Jl. Bisnis Raya No. 5\",
    \"city\": \"Jakarta\",
    \"province\": \"DKI Jakarta\",
    \"postal_code\": \"12345\",
    \"business_activity\": \"Perdagangan Umum\",
    \"phone\": \"021$TS\"
  }")
echo "$BIZ_RES" | jq .
BIZ_APP_ID=$(echo "$BIZ_RES" | jq -r '.id')
echo "→ BIZ_APP_ID=$BIZ_APP_ID"

echo ""
echo "F-02: Submit bisnis tanpa docs & party → 400"
curl -s -X PATCH "$BASE_URL/applications/$BIZ_APP_ID/submit" \
  -H "Authorization: Bearer $TOKEN" | jq '{message, missing}'

echo ""
echo "F-03: Add 3 dokumen korporasi wajib"
for DOC_TYPE in "AKTA_PENDIRIAN" "NIB_SIUP" "NPWP_BADAN"; do
  echo "  → Adding $DOC_TYPE"
  curl -s -X POST "$BASE_URL/applications/$BIZ_APP_ID/documents" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"doc_type\":\"$DOC_TYPE\",\"file_uri\":\"https://storage.test/$DOC_TYPE.pdf\"}" \
    | jq '.doc_type'
done

echo ""
echo "F-04: Submit bisnis dengan docs tapi tanpa party → 400 (party missing)"
curl -s -X PATCH "$BASE_URL/applications/$BIZ_APP_ID/submit" \
  -H "Authorization: Bearer $TOKEN" | jq '{message, missing}'

echo ""
echo "F-05: Add DIRECTOR party → 201"
curl -s -X POST "$BASE_URL/applications/$BIZ_APP_ID/parties" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"role\": \"DIRECTOR\",
    \"full_name\": \"Direktur Utama $TS\",
    \"identity_type\": \"KTP\",
    \"identity_number\": \"3276000$TS\",
    \"dob\": \"1975-09-01\",
    \"nationality\": \"ID\",
    \"phone\": \"0816$TS\"
  }" | jq '{id, role, is_active}'

echo ""
echo "F-06: Submit bisnis (docs + party) → 200 SUBMITTED"
curl -s -X PATCH "$BASE_URL/applications/$BIZ_APP_ID/submit" \
  -H "Authorization: Bearer $TOKEN" | jq '{status, risk: .risk.risk_level}'

echo ""
echo "F-07: Decision APPROVE bisnis → 200"
curl -s -X PATCH "$BASE_URL/applications/$BIZ_APP_ID/decision" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"decision":"APPROVED"}' | jq '{status}'

# ──────────────────────────────────────────────────
# SECTION G: DASHBOARD & REGISTRANTS
# ──────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "G-01: GET /kyc/dashboard-summary"
echo "═══════════════════════════════════════════"
curl -s "$BASE_URL/kyc/dashboard-summary" \
  -H "Authorization: Bearer $TOKEN" | jq '{totals, recent_count: (.recent | length)}'

echo ""
echo "G-02: GET /kyc/submissions"
curl -s "$BASE_URL/kyc/submissions?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq 'length'

echo ""
echo "G-03: GET /kyc/registrants?type=INDIVIDUAL"
curl -s "$BASE_URL/kyc/registrants?type=INDIVIDUAL&limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '{total, count: (.items | length)}'

echo ""
echo "G-04: GET /kyc/registrants?type=BUSINESS"
curl -s "$BASE_URL/kyc/registrants?type=BUSINESS&limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '{total, count: (.items | length)}'

# ──────────────────────────────────────────────────
# SECTION H: WATCHLIST HISTORY
# ──────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "H-01: GET /watchlist/history"
echo "═══════════════════════════════════════════"
curl -s "$BASE_URL/watchlist/history?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq 'length'

# ──────────────────────────────────────────────────
# SECTION I: TRANSFER FLOW
# Login sebagai FinanceStaff dulu — buat user via sysadmin jika belum ada
# ──────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "I-01: Login SystemAdmin"
echo "═══════════════════════════════════════════"
SYS_RES=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"sysadmin@kesh.local","password":"SystemAdmin@123"}')
SYS_TOKEN=$(echo "$SYS_RES" | jq -r '.access_token')

echo ""
echo "I-02: Buat user FinanceStaff"
STAFF_EMAIL="staff$TS@test.local"
curl -s -X POST "$BASE_URL/users/admins" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SYS_TOKEN" \
  -d "{
    \"email\": \"$STAFF_EMAIL\",
    \"fullName\": \"Test Finance Staff $TS\",
    \"role\": \"FinanceStaff\",
    \"password\": \"Test@123456\"
  }" | jq '{id, email, role}'

echo ""
echo "I-03: Login sebagai FinanceStaff"
STAFF_RES=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$STAFF_EMAIL\",\"password\":\"Test@123456\"}")
STAFF_TOKEN=$(echo "$STAFF_RES" | jq -r '.access_token')
echo "→ STAFF_TOKEN saved"

echo ""
echo "I-04: POST /transfers dengan DRAFT app → 400 not approved"
curl -s -X POST "$BASE_URL/transfers" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -d "{
    \"amount\": 500000,
    \"sender_application_id\": $APPLICATION_ID,
    \"beneficiaryBankName\": \"Bank Test\",
    \"beneficiaryAccountNumber\": \"1234567890\",
    \"beneficiaryAccountName\": \"Penerima Test\"
  }" | jq '{statusCode, message}'

echo ""
echo "I-05: POST /transfers dengan APPROVED app → 201 DRAFT"
TRANSFER_RES=$(curl -s -X POST "$BASE_URL/transfers" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -d "{
    \"amount\": 1000000,
    \"sender_application_id\": $APP_OK_ID,
    \"beneficiaryBankName\": \"Bank Mandiri\",
    \"beneficiaryAccountNumber\": \"9876543210\",
    \"beneficiaryAccountName\": \"PT Penerima Dana\",
    \"description\": \"Test transfer manual\"
  }")
echo "$TRANSFER_RES" | jq .
TRANSFER_ID=$(echo "$TRANSFER_RES" | jq -r '.id')
echo "→ TRANSFER_ID=$TRANSFER_ID"

echo ""
echo "I-06: POST /transfers/:id/submit → 200 SUBMITTED"
curl -s -X POST "$BASE_URL/transfers/$TRANSFER_ID/submit" \
  -H "Authorization: Bearer $STAFF_TOKEN" | jq '{id, status}'

echo ""
echo "I-07: Buat FinanceManager"
MANAGER_EMAIL="manager$TS@test.local"
curl -s -X POST "$BASE_URL/users/admins" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SYS_TOKEN" \
  -d "{
    \"email\": \"$MANAGER_EMAIL\",
    \"fullName\": \"Test Finance Manager $TS\",
    \"role\": \"FinanceManager\",
    \"password\": \"Test@123456\"
  }" | jq '{id, email, role}'

MANAGER_RES=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$MANAGER_EMAIL\",\"password\":\"Test@123456\"}")
MANAGER_TOKEN=$(echo "$MANAGER_RES" | jq -r '.access_token')
echo "→ MANAGER_TOKEN saved"

echo ""
echo "I-08: POST /transfers/:id/decision APPROVE → status APPROVED"
curl -s -X POST "$BASE_URL/transfers/$TRANSFER_ID/decision" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -d '{"decision":"APPROVE","note":"Approved"}' | jq '{id, status}'

echo ""
echo "I-09: POST /transfers/:id/result SUCCESS → COMPLETED"
curl -s -X POST "$BASE_URL/transfers/$TRANSFER_ID/result" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -d '{"result":"SUCCESS","note":"Transfer berhasil dieksekusi"}' | jq '{id, status, result}'

# ──────────────────────────────────────────────────
# SECTION J: WATCHLIST UPLOAD (multipart — jalankan manual)
# ──────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "J-01: Watchlist Upload (MANUAL — butuh file xlsx)"
echo "Jalankan perintah berikut secara manual:"
echo ""
echo "  curl -s -X POST \"$BASE_URL/watchlist/upload\" \\"
echo "    -H \"Authorization: Bearer \$TOKEN\" \\"
echo "    -F \"file=@/path/to/pep_list.xlsx\" \\"
echo "    -F \"list_type=PEP\" \\"
echo "    -F \"list_source=PPATK\""
echo ""
echo "J-02: Upload non-xlsx → 400"
echo "  curl -s -X POST \"$BASE_URL/watchlist/upload\" \\"
echo "    -H \"Authorization: Bearer \$TOKEN\" \\"
echo "    -F \"file=@/path/to/file.txt\" \\"
echo "    -F \"list_type=PEP\" \\"
echo "    -F \"list_source=TEST\""

echo ""
echo "═══════════════════════════════════════════"
echo "DONE — All manual curl tests complete"
echo "═══════════════════════════════════════════"
