"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransfersService = void 0;
const common_1 = require("@nestjs/common");
const pg_1 = require("pg");
const auth_util_1 = require("../../common/auth.util");
const snap_util_1 = require("./snap.util");
const monitoring_service_1 = require("../monitoring/monitoring.service");
let TransfersService = class TransfersService {
    constructor(pool, monitoring) {
        this.pool = pool;
        this.monitoring = monitoring;
    }
    async audit(actorId, action, objectId, before, after, ip) {
        await this.pool.query(`INSERT INTO audit_logs(actor_id, action, object_type, object_id, before_json, after_json, ip)
       VALUES ($1,$2,'TRANSFER',$3,$4,$5,$6)`, [actorId, action, objectId, before ?? null, after ?? null, ip ?? null]);
    }
    /**
     * Pastikan partner_reference_no unik. Jika user mengirim sendiri → validasi
     * tidak duplikat. Jika kosong → generate server-side dengan retry anti-tabrakan.
     */
    async resolvePartnerReferenceNo(provided) {
        if (provided && provided.trim().length > 0) {
            const ref = provided.trim();
            if (ref.length > 64) {
                throw new common_1.BadRequestException("partner_reference_no max 64 chars");
            }
            const dup = await this.pool.query(`SELECT 1 FROM transfers WHERE partner_reference_no = $1 LIMIT 1`, [ref]);
            if ((dup.rowCount ?? 0) > 0) {
                throw new common_1.BadRequestException("partner_reference_no already exists");
            }
            return ref;
        }
        // Generate dengan retry — entropy tinggi, tabrakan sangat jarang.
        for (let i = 0; i < 5; i++) {
            const candidate = (0, snap_util_1.generatePartnerReferenceNo)();
            const dup = await this.pool.query(`SELECT 1 FROM transfers WHERE partner_reference_no = $1 LIMIT 1`, [candidate]);
            if ((dup.rowCount ?? 0) === 0)
                return candidate;
        }
        throw new common_1.BadRequestException("Failed to generate unique partner_reference_no, please retry");
    }
    // ---------------------------------------------------------------------------
    // CREATE DRAFT
    // ---------------------------------------------------------------------------
    async create(user, dto, ip) {
        const isStaff = user.role === "FinanceStaff";
        const isManager = user.role === "FinanceManager";
        if (!isStaff && !isManager) {
            throw new common_1.ForbiddenException("Not allowed");
        }
        // ✅ validasi sender_application_id — harus ada & KYC/KYB APPROVED
        const { rows: senderRows } = await this.pool.query(`SELECT person_id, status
     FROM applications
     WHERE id = $1`, [dto.sender_application_id]);
        if (!senderRows[0]) {
            throw new common_1.BadRequestException("Sender application not found");
        }
        const senderApp = senderRows[0];
        if (senderApp.status !== "APPROVED") {
            throw new common_1.BadRequestException("Sender is not KYC/KYB approved");
        }
        // ── SNAP-ready derivations ──────────────────────────────────────────
        const partnerRef = await this.resolvePartnerReferenceNo(dto.partner_reference_no);
        const amountCurrency = (0, snap_util_1.normalizeCurrency)(dto.currency);
        const amountValue = (0, snap_util_1.formatAmountValue)(dto.amount);
        const transferMethod = dto.transfer_method ?? "BANK_TRANSFER";
        const transferChannel = dto.transfer_channel ?? "MANUAL";
        const additionalInfo = dto.additional_info ?? {};
        // ✅ insert transfer
        const q = await this.pool.query(`INSERT INTO transfers(
        branch_id,
        amount,
        currency,
        beneficiary_bank_name,
        beneficiary_bank_code,
        beneficiary_account_number,
        beneficiary_account_name,
        description,
        requested_transfer_at,
        created_by,
        sender_application_id,
        partner_reference_no,
        amount_value,
        amount_currency,
        source_account_no,
        source_account_name,
        source_bank_code,
        source_bank_name,
        beneficiary_address,
        beneficiary_email,
        beneficiary_customer_residence,
        beneficiary_customer_type,
        transfer_method,
        transfer_channel,
        transaction_date,
        requested_execution_date,
        additional_info,
        source_of_funds,
        transaction_purpose,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29, now()
      )
      RETURNING *`, [
            null, // branch belum dipakai
            dto.amount,
            amountCurrency,
            dto.beneficiaryBankName,
            dto.beneficiaryBankCode ?? null,
            dto.beneficiaryAccountNumber,
            dto.beneficiaryAccountName,
            dto.description ?? null,
            dto.requestedTransferAt ?? null,
            (0, auth_util_1.resolveUserId)(user),
            dto.sender_application_id,
            partnerRef,
            amountValue,
            amountCurrency,
            dto.source_account_no ?? null,
            dto.source_account_name ?? null,
            dto.source_bank_code ?? null,
            dto.source_bank_name ?? null,
            dto.beneficiary_address ?? null,
            dto.beneficiary_email ?? null,
            dto.beneficiary_customer_residence ?? null,
            dto.beneficiary_customer_type ?? null,
            transferMethod,
            transferChannel,
            dto.transaction_date ?? null,
            dto.requested_execution_date ?? null,
            JSON.stringify(additionalInfo),
            dto.source_of_funds ?? null,
            dto.transaction_purpose ?? null,
        ]);
        const row = q.rows[0];
        await this.audit((0, auth_util_1.resolveUserId)(user), "TRANSFER_CREATE", String(row.id), null, row, ip);
        // Auto monitoring evaluation — tidak boleh menggagalkan transfer.
        await this.monitoring.safeEvaluateTransfer(Number(row.id), user);
        return row;
    }
    // ---------------------------------------------------------------------------
    // UPDATE DRAFT
    // ---------------------------------------------------------------------------
    async updateDraft(id, user, dto, ip) {
        const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [
            id,
        ]);
        const rowCount = prev.rowCount ?? 0;
        if (rowCount === 0)
            throw new common_1.NotFoundException("Transfer not found");
        const row = prev.rows[0];
        if (row.status !== "DRAFT") {
            throw new common_1.BadRequestException("Only DRAFT can be updated");
        }
        // partner_reference_no tidak pernah di-regenerate setelah create.
        const amountCurrency = (0, snap_util_1.normalizeCurrency)(dto.currency ?? row.amount_currency);
        const amountValue = (0, snap_util_1.formatAmountValue)(dto.amount);
        const next = await this.pool.query(`UPDATE transfers SET
        amount=$2,
        currency=$3,
        amount_value=$4,
        amount_currency=$5,
        beneficiary_bank_name=$6,
        beneficiary_bank_code=$7,
        beneficiary_account_number=$8,
        beneficiary_account_name=$9,
        description=$10,
        requested_transfer_at=$11,
        source_account_no=COALESCE($12, source_account_no),
        source_account_name=COALESCE($13, source_account_name),
        source_bank_code=COALESCE($14, source_bank_code),
        source_bank_name=COALESCE($15, source_bank_name),
        beneficiary_address=COALESCE($16, beneficiary_address),
        beneficiary_email=COALESCE($17, beneficiary_email),
        beneficiary_customer_residence=COALESCE($18, beneficiary_customer_residence),
        beneficiary_customer_type=COALESCE($19, beneficiary_customer_type),
        transfer_method=COALESCE($20, transfer_method),
        transfer_channel=COALESCE($21, transfer_channel),
        transaction_date=COALESCE($22, transaction_date),
        requested_execution_date=COALESCE($23, requested_execution_date),
        additional_info=COALESCE($24, additional_info),
        source_of_funds=COALESCE($25, source_of_funds),
        transaction_purpose=COALESCE($26, transaction_purpose),
        updated_at=now()
      WHERE id=$1
      RETURNING *`, [
            id,
            dto.amount,
            amountCurrency,
            amountValue,
            amountCurrency,
            dto.beneficiaryBankName,
            dto.beneficiaryBankCode ?? null,
            dto.beneficiaryAccountNumber,
            dto.beneficiaryAccountName,
            dto.description ?? null,
            dto.requestedTransferAt ?? null,
            dto.source_account_no ?? null,
            dto.source_account_name ?? null,
            dto.source_bank_code ?? null,
            dto.source_bank_name ?? null,
            dto.beneficiary_address ?? null,
            dto.beneficiary_email ?? null,
            dto.beneficiary_customer_residence ?? null,
            dto.beneficiary_customer_type ?? null,
            dto.transfer_method ?? null,
            dto.transfer_channel ?? null,
            dto.transaction_date ?? null,
            dto.requested_execution_date ?? null,
            dto.additional_info ? JSON.stringify(dto.additional_info) : null,
            dto.source_of_funds ?? null,
            dto.transaction_purpose ?? null,
        ]);
        await this.audit((0, auth_util_1.resolveUserId)(user), "TRANSFER_UPDATE_DRAFT", String(id), row, next.rows[0], ip);
        return next.rows[0];
    }
    // ---------------------------------------------------------------------------
    // SUBMIT (FinanceStaff)
    // ---------------------------------------------------------------------------
    async submit(id, user, ip) {
        const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [
            id,
        ]);
        const rowCount = prev.rowCount ?? 0;
        if (rowCount === 0)
            throw new common_1.NotFoundException("Transfer not found");
        const row = prev.rows[0];
        // Hanya FinanceStaff yang boleh submit (SystemAdmin read-only).
        if (user.role !== "FinanceStaff") {
            throw new common_1.ForbiddenException("Only FinanceStaff can submit");
        }
        if (row.status !== "DRAFT") {
            throw new common_1.BadRequestException("Only DRAFT can be submitted");
        }
        // Jangan izinkan submit jika field transfer wajib belum lengkap.
        const missing = [];
        if (!row.beneficiary_account_number)
            missing.push("beneficiary_account_number");
        if (!row.beneficiary_account_name)
            missing.push("beneficiary_account_name");
        if (!row.beneficiary_bank_name)
            missing.push("beneficiary_bank_name");
        if (!(Number(row.amount) > 0))
            missing.push("amount");
        if (missing.length > 0) {
            throw new common_1.BadRequestException(`Cannot submit, missing mandatory fields: ${missing.join(", ")}`);
        }
        const next = await this.pool.query(`UPDATE transfers SET
       status = 'SUBMITTED',
       submitted_by = $2,
       submitted_at = now(),
       updated_at = now()
     WHERE id = $1
     RETURNING *`, [id, (0, auth_util_1.resolveUserId)(user)]);
        await this.audit((0, auth_util_1.resolveUserId)(user), "TRANSFER_SUBMIT", String(id), row, next.rows[0], ip);
        // Auto monitoring evaluation — tidak boleh menggagalkan transfer.
        await this.monitoring.safeEvaluateTransfer(id, user);
        return next.rows[0];
    }
    // ---------------------------------------------------------------------------
    // DECIDE (APPROVE / REJECT) – FinanceManager
    // ---------------------------------------------------------------------------
    async decide(id, user, dto, ip) {
        const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [
            id,
        ]);
        const rowCount = prev.rowCount ?? 0;
        if (rowCount === 0)
            throw new common_1.NotFoundException("Transfer not found");
        const row = prev.rows[0];
        // Hanya FinanceManager yang boleh decide (SystemAdmin read-only).
        if (user.role !== "FinanceManager") {
            throw new common_1.ForbiddenException("Only FinanceManager can approve/reject");
        }
        if (row.status !== "SUBMITTED") {
            throw new common_1.BadRequestException("Only SUBMITTED can be approved/rejected");
        }
        const decisionNotes = dto.decision_notes ?? dto.note ?? null;
        const actorId = (0, auth_util_1.resolveUserId)(user);
        let next;
        if (dto.decision === "APPROVE") {
            next = await this.pool.query(`UPDATE transfers SET
          status='APPROVED',
          approved_by=$2,
          approved_at=now(),
          decision_notes=$3,
          updated_at=now()
        WHERE id=$1
        RETURNING *`, [id, actorId, decisionNotes]);
        }
        else if (dto.decision === "REJECT") {
            next = await this.pool.query(`UPDATE transfers SET
          status='REJECTED',
          rejected_by=$2,
          rejected_at=now(),
          reject_reason=$3,
          decision_notes=$4,
          updated_at=now()
        WHERE id=$1
        RETURNING *`, [id, actorId, dto.reject_reason ?? null, decisionNotes]);
        }
        else {
            throw new common_1.BadRequestException("decision must be APPROVE or REJECT");
        }
        await this.audit(actorId, `TRANSFER_${next.rows[0].status}`, String(id), row, next.rows[0], ip);
        return next.rows[0];
    }
    // ---------------------------------------------------------------------------
    // SET RESULT (SUCCESS/FAILED) – FinanceManager
    // ---------------------------------------------------------------------------
    async setResult(id, user, dto, ip) {
        const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [
            id,
        ]);
        const rowCount = prev.rowCount ?? 0;
        if (rowCount === 0)
            throw new common_1.NotFoundException("Transfer not found");
        const row = prev.rows[0];
        // Hanya FinanceManager yang boleh set result (SystemAdmin read-only).
        if (user.role !== "FinanceManager") {
            throw new common_1.ForbiddenException("Only FinanceManager can set result");
        }
        if (row.status !== "APPROVED") {
            throw new common_1.BadRequestException("Only APPROVED can be completed");
        }
        if (dto.result !== "SUCCESS" && dto.result !== "FAILED") {
            throw new common_1.BadRequestException("result must be SUCCESS or FAILED");
        }
        const actorId = (0, auth_util_1.resolveUserId)(user);
        const resultNotes = dto.result_notes ?? dto.note ?? null;
        const isSuccess = dto.result === "SUCCESS";
        const next = await this.pool.query(`UPDATE transfers SET
        status='COMPLETED',
        result=$2,
        result_notes=$3,
        attachment_uri = COALESCE($4, attachment_uri),
        result_attachment_uri = COALESCE($5, result_attachment_uri),
        result_reference_no = COALESCE($6, result_reference_no),
        bank_reference_no = COALESCE($7, bank_reference_no),
        external_reference_no = COALESCE($8, external_reference_no),
        provider_reference_no = COALESCE($9, provider_reference_no),
        latest_transaction_status = COALESCE($10, latest_transaction_status),
        transaction_status_desc = COALESCE($11, transaction_status_desc),
        provider_response_code = COALESCE($12, provider_response_code),
        provider_response_message = COALESCE($13, provider_response_message),
        provider_response = COALESCE($14, provider_response),
        failed_reason = $15,
        completed_at = $16,
        failed_at = $17,
        result_updated_by = $18,
        result_updated_at = now(),
        updated_at=now()
      WHERE id=$1
      RETURNING *`, [
            id,
            dto.result,
            resultNotes,
            dto.attachmentUri ?? null,
            dto.result_attachment_uri ?? null,
            dto.result_reference_no ?? null,
            dto.bank_reference_no ?? null,
            dto.external_reference_no ?? null,
            dto.provider_reference_no ?? null,
            dto.latest_transaction_status ?? null,
            dto.transaction_status_desc ?? null,
            dto.provider_response_code ?? null,
            dto.provider_response_message ?? null,
            dto.provider_response ? JSON.stringify(dto.provider_response) : null,
            isSuccess ? null : dto.failed_reason ?? null,
            isSuccess ? new Date() : null,
            isSuccess ? null : new Date(),
            actorId,
        ]);
        await this.audit(actorId, "TRANSFER_SET_RESULT", String(id), row, next.rows[0], ip);
        // Auto monitoring evaluation pada hasil SUCCESS — tidak boleh menggagalkan transfer.
        if (isSuccess) {
            await this.monitoring.safeEvaluateTransfer(id, user);
        }
        return next.rows[0];
    }
    // ---------------------------------------------------------------------------
    // LIST – FinanceStaff: hanya miliknya; FinanceManager/SystemAdmin: semua
    // ---------------------------------------------------------------------------
    async list(user, status) {
        const role = user.role;
        const params = [];
        let where = "WHERE 1=1";
        if (role === "FinanceStaff") {
            // 🔹 Staff → hanya transfer yang dia buat
            // plus data lama yang belum punya created_by (NULL) supaya tetap kelihatan
            params.push((0, auth_util_1.resolveUserId)(user));
            where += ` AND (t.created_by = $${params.length} OR t.created_by IS NULL)`;
        }
        // 🔹 FinanceManager, SystemAdmin, dll → tidak ada filter khusus
        const normStatus = status?.toUpperCase();
        if (normStatus && normStatus !== "ALL") {
            params.push(normStatus);
            where += ` AND t.status = $${params.length}`;
        }
        const q = await this.pool.query(`SELECT
         t.id, t.partner_reference_no, t.reference_no, t.sender_application_id,
         t.amount, t.currency, t.amount_value, t.amount_currency,
         t.beneficiary_account_name, t.beneficiary_account_number,
         t.beneficiary_bank_code, t.beneficiary_bank_name,
         t.status, t.result, t.created_at, t.submitted_at, t.approved_at,
         t.completed_at, t.failed_at,
         t.source_of_funds, t.transaction_purpose,
         COALESCE(p.full_name, b.legal_name) AS sender_name,
         COALESCE(p.cif_no, b.cif_no)       AS sender_cif_no,
         a.type                              AS sender_type
       FROM transfers t
       LEFT JOIN applications a ON a.id = t.sender_application_id
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       ${where}
       ORDER BY t.id DESC
       LIMIT 200`, params);
        return q.rows;
    }
    // ---------------------------------------------------------------------------
    // DETAIL
    // ---------------------------------------------------------------------------
    async getById(id, user) {
        const isManager = user.role === "FinanceManager" || user.role === "SystemAdmin";
        const q = await this.pool.query(`SELECT t.*,
              COALESCE(p.full_name, b.legal_name) AS sender_name,
              COALESCE(p.cif_no, b.cif_no)       AS sender_cif_no,
              a.type                              AS sender_type
       FROM transfers t
       LEFT JOIN applications a ON a.id = t.sender_application_id
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       WHERE t.id=$1`, [id]);
        const rowCount = q.rowCount ?? 0;
        if (rowCount === 0) {
            throw new common_1.NotFoundException("Transfer not found");
        }
        const row = q.rows[0];
        // Non-manager hanya boleh lihat transfer yang dia buat.
        // pg mengembalikan BIGINT sebagai string → bandingkan sebagai string.
        if (!isManager) {
            const creatorId = row.created_by !== null && row.created_by !== undefined
                ? String(row.created_by)
                : null;
            const userId = String((0, auth_util_1.resolveUserId)(user));
            if (creatorId !== null && creatorId !== userId) {
                throw new common_1.ForbiddenException("Not allowed");
            }
        }
        return row;
    }
    // ---------------------------------------------------------------------------
    // SNAP PREVIEW – pure mapping, NO external call
    // ---------------------------------------------------------------------------
    async snapPreview(id, user) {
        const row = await this.getById(id, user);
        return (0, snap_util_1.buildSnapTransferPayload)(row);
    }
    // ---------------------------------------------------------------------------
    // SENDER SEARCH — cari aplikasi APPROVED sebagai calon pengirim
    // ---------------------------------------------------------------------------
    async searchSenders(q = '', page = 1, limit = 20) {
        const pageN = Math.max(1, page);
        const limitN = Math.min(100, Math.max(1, limit));
        const offset = (pageN - 1) * limitN;
        const pattern = `%${q}%`;
        const countQ = await this.pool.query(`SELECT COUNT(*)::int AS total
       FROM applications a
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       WHERE a.status = 'APPROVED'
         AND ($1 = '' OR COALESCE(p.full_name, b.legal_name) ILIKE $2
              OR COALESCE(p.cif_no, b.cif_no) ILIKE $2
              OR COALESCE(p.identity_number, '') ILIKE $2
              OR COALESCE(b.nib, '') ILIKE $2
              OR COALESCE(b.npwp, '') ILIKE $2)`, [q, pattern]);
        const dataQ = await this.pool.query(`SELECT a.id AS application_id, a.type AS application_type, a.status,
              COALESCE(p.full_name, b.legal_name) AS display_name,
              COALESCE(p.cif_no, b.cif_no) AS cif_no,
              COALESCE(p.identity_number, b.nib) AS identity_number_or_business_number
       FROM applications a
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       WHERE a.status = 'APPROVED'
         AND ($1 = '' OR COALESCE(p.full_name, b.legal_name) ILIKE $2
              OR COALESCE(p.cif_no, b.cif_no) ILIKE $2
              OR COALESCE(p.identity_number, '') ILIKE $2
              OR COALESCE(b.nib, '') ILIKE $2
              OR COALESCE(b.npwp, '') ILIKE $2)
       ORDER BY a.id DESC
       LIMIT $3 OFFSET $4`, [q, pattern, limitN, offset]);
        return { data: dataQ.rows, page: pageN, limit: limitN, total: countQ.rows[0].total };
    }
    // ---------------------------------------------------------------------------
    // BANK CATALOG — daftar bank statis untuk FE dropdown
    // ---------------------------------------------------------------------------
    getBanks() {
        return [
            { code: 'BCA', name: 'Bank Central Asia' },
            { code: 'MANDIRI', name: 'Bank Mandiri' },
            { code: 'BRI', name: 'Bank Rakyat Indonesia' },
            { code: 'BNI', name: 'Bank Negara Indonesia' },
            { code: 'CIMB', name: 'CIMB Niaga' },
            { code: 'DANAMON', name: 'Bank Danamon' },
            { code: 'PERMATA', name: 'Bank Permata' },
            { code: 'BTN', name: 'Bank Tabungan Negara' },
            { code: 'BSI', name: 'Bank Syariah Indonesia' },
            { code: 'MAYBANK', name: 'Maybank Indonesia' },
            { code: 'OCBC', name: 'OCBC Indonesia' },
            { code: 'PANIN', name: 'Panin Bank' },
            { code: 'NOBU', name: 'Bank Nobu' },
        ];
    }
};
exports.TransfersService = TransfersService;
exports.TransfersService = TransfersService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)("PG_POOL")),
    __metadata("design:paramtypes", [pg_1.Pool,
        monitoring_service_1.MonitoringService])
], TransfersService);
//# sourceMappingURL=transfers.service.js.map