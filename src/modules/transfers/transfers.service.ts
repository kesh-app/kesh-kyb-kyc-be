import {
  Inject,
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Pool } from "pg";
import {
  ComplianceReviewDecisionDto,
  CreateTransferDto,
  DecideTransferDto,
  SetTransferResultDto,
  SubmitComplianceReviewDto,
  UpdateTransferDto,
} from "./dto";
import { resolveUserId } from "../../common/auth.util";
import {
  buildSnapTransferPayload,
  formatAmountValue,
  generatePartnerReferenceNo,
  normalizeCurrency,
} from "./snap.util";
import { MonitoringService } from "../monitoring/monitoring.service";

type AuthedUser = { sub?: number | string; id?: number | string; role: string };

const FULL_ACCESS_ROLES = ["SystemAdmin", "Director"];
const WIC_TRANSFER_MAX_AMOUNT = 100_000_000;
const WIC_LIMIT_ERROR = "Walk-In Customer (WIC) memiliki limit transaksi maksimal Rp100.000.000.";

@Injectable()
export class TransfersService {
  constructor(
    @Inject("PG_POOL") private readonly pool: Pool,
    private readonly monitoring: MonitoringService,
  ) {}

  private async audit(
    actorId: number | string,
    action: string,
    objectId: string,
    before: any,
    after: any,
    ip?: string,
  ) {
    await this.pool.query(
      `INSERT INTO audit_logs(actor_id, action, object_type, object_id, before_json, after_json, ip)
       VALUES ($1,$2,'TRANSFER',$3,$4,$5,$6)`,
      [actorId, action, objectId, before ?? null, after ?? null, ip ?? null],
    );
  }

  /**
   * Pastikan partner_reference_no unik. Jika user mengirim sendiri → validasi
   * tidak duplikat. Jika kosong → generate server-side dengan retry anti-tabrakan.
   */
  private async resolvePartnerReferenceNo(provided?: string): Promise<string> {
    if (provided && provided.trim().length > 0) {
      const ref = provided.trim();
      if (ref.length > 64) {
        throw new BadRequestException("partner_reference_no max 64 chars");
      }
      const dup = await this.pool.query(
        `SELECT 1 FROM transfers WHERE partner_reference_no = $1 LIMIT 1`,
        [ref],
      );
      if ((dup.rowCount ?? 0) > 0) {
        throw new BadRequestException("partner_reference_no already exists");
      }
      return ref;
    }

    // Generate dengan retry — entropy tinggi, tabrakan sangat jarang.
    for (let i = 0; i < 5; i++) {
      const candidate = generatePartnerReferenceNo();
      const dup = await this.pool.query(
        `SELECT 1 FROM transfers WHERE partner_reference_no = $1 LIMIT 1`,
        [candidate],
      );
      if ((dup.rowCount ?? 0) === 0) return candidate;
    }
    throw new BadRequestException(
      "Failed to generate unique partner_reference_no, please retry",
    );
  }

  /**
   * Hard guard: pengirim (sender_application_id) wajib ada dan berstatus
   * APPROVED. Dipakai saat create, update draft, dan submit agar draft lama
   * dengan pengirim non-APPROVED tidak bisa lolos ke pencatatan transfer.
   */
  private async assertSenderApproved(
    applicationId: number | string | null | undefined,
  ) {
    if (applicationId === null || applicationId === undefined) {
      throw new BadRequestException(
        "Pengguna jasa harus berstatus APPROVED untuk pencatatan transfer.",
      );
    }

    const { rows } = await this.pool.query(
      `SELECT a.id, a.person_id, a.business_id, a.status, a.type,
              p.cif_relationship_type
         FROM applications a
         LEFT JOIN persons p ON p.id = a.person_id
        WHERE a.id = $1`,
      [applicationId],
    );

    const senderApp = rows[0];
    if (!senderApp) {
      throw new BadRequestException("Sender application not found");
    }

    if (senderApp.status !== "APPROVED") {
      throw new BadRequestException(
        "Pengguna jasa harus berstatus APPROVED untuk pencatatan transfer.",
      );
    }

    return senderApp;
  }

  private async assertWicTransferLimit(
    applicationId: number | string | null | undefined,
    amount: number | string | null | undefined,
  ) {
    if (applicationId === null || applicationId === undefined) return;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) return;

    const { rows } = await this.pool.query(
      `SELECT p.cif_relationship_type
         FROM applications a
         JOIN persons p ON p.id = a.person_id
        WHERE a.id = $1 AND a.type = 'INDIVIDUAL'
        LIMIT 1`,
      [applicationId],
    );

    if (rows[0]?.cif_relationship_type === 'WIC' && numericAmount > WIC_TRANSFER_MAX_AMOUNT) {
      throw new BadRequestException(WIC_LIMIT_ERROR);
    }
  }

  // ---------------------------------------------------------------------------
  // CREATE DRAFT
  // ---------------------------------------------------------------------------
  async create(user: AuthedUser, dto: CreateTransferDto, ip?: string) {
    const isStaff = user.role === "FinanceStaff" || user.role === "FrontDesk";
    const isManager = user.role === "FinanceManager";

    if (!isStaff && !isManager && !FULL_ACCESS_ROLES.includes(user.role)) {
      throw new ForbiddenException("Not allowed");
    }

    // ✅ validasi sender_application_id — harus ada & KYC/KYB APPROVED
    await this.assertSenderApproved(dto.sender_application_id);
    await this.assertWicTransferLimit(dto.sender_application_id, dto.amount);

    // ── SNAP-ready derivations ──────────────────────────────────────────
    const partnerRef = await this.resolvePartnerReferenceNo(
      dto.partner_reference_no,
    );
    const amountCurrency = normalizeCurrency(dto.currency);
    const amountValue = formatAmountValue(dto.amount);
    const transferMethod = dto.transfer_method ?? "BANK_TRANSFER";
    const transferChannel = dto.transfer_channel ?? "MANUAL";
    const additionalInfo = dto.additional_info ?? {};

    // ✅ insert transfer
    const q = await this.pool.query(
      `INSERT INTO transfers(
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
      RETURNING *`,
      [
        null, // branch belum dipakai
        dto.amount,
        amountCurrency,
        dto.beneficiaryBankName,
        dto.beneficiaryBankCode ?? null,
        dto.beneficiaryAccountNumber,
        dto.beneficiaryAccountName,
        dto.description ?? null,
        dto.requestedTransferAt ?? null,
        resolveUserId(user),
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
      ],
    );

    const row = q.rows[0];

    await this.audit(resolveUserId(user), "TRANSFER_CREATE", String(row.id), null, row, ip);

    // Auto monitoring evaluation — tidak boleh menggagalkan transfer.
    await this.monitoring.safeEvaluateTransfer(Number(row.id), user);

    return row;
  }

  // ---------------------------------------------------------------------------
  // UPDATE DRAFT
  // ---------------------------------------------------------------------------
  async updateDraft(
    id: number,
    user: AuthedUser,
    dto: UpdateTransferDto,
    ip?: string,
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [
      id,
    ]);
    const rowCount = prev.rowCount ?? 0;
    if (rowCount === 0) throw new NotFoundException("Transfer not found");

    const row = prev.rows[0];
    if (row.status !== "DRAFT") {
      throw new BadRequestException("Only DRAFT can be updated");
    }

    // Hard guard: pengirim draft harus tetap APPROVED. Mencegah update draft
    // lama yang pengirimnya sudah tidak APPROVED lagi.
    await this.assertSenderApproved(row.sender_application_id);
    await this.assertWicTransferLimit(row.sender_application_id, dto.amount ?? row.amount);

    // partner_reference_no tidak pernah di-regenerate setelah create.
    const amountCurrency = normalizeCurrency(dto.currency ?? row.amount_currency);
    const amountValue = formatAmountValue(dto.amount);

    const next = await this.pool.query(
      `UPDATE transfers SET
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
      RETURNING *`,
      [
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
      ],
    );

    await this.audit(
      resolveUserId(user),
      "TRANSFER_UPDATE_DRAFT",
      String(id),
      row,
      next.rows[0],
      ip,
    );
    return next.rows[0];
  }

  // ---------------------------------------------------------------------------
  // SUBMIT (FinanceStaff)
  // ---------------------------------------------------------------------------
  async submit(id: number, user: AuthedUser, ip?: string) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [
      id,
    ]);
    const rowCount = prev.rowCount ?? 0;
    if (rowCount === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    if (
      user.role !== "FinanceStaff" &&
      user.role !== "FrontDesk" &&
      !FULL_ACCESS_ROLES.includes(user.role)
    ) {
      throw new ForbiddenException("Only FinanceStaff or FrontDesk can submit");
    }

    if (row.status !== "DRAFT") {
      throw new BadRequestException("Only DRAFT can be submitted");
    }

    // Hard guard: pengirim wajib tetap APPROVED saat submit. Mencegah draft
    // lama dengan pengirim non-APPROVED lolos ke tahap SUBMITTED.
    await this.assertSenderApproved(row.sender_application_id);
    await this.assertWicTransferLimit(row.sender_application_id, row.amount);

    // Jangan izinkan submit jika field transfer wajib belum lengkap.
    const missing: string[] = [];
    if (!row.beneficiary_account_number) missing.push("beneficiary_account_number");
    if (!row.beneficiary_account_name) missing.push("beneficiary_account_name");
    if (!row.beneficiary_bank_name) missing.push("beneficiary_bank_name");
    if (!(Number(row.amount) > 0)) missing.push("amount");
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot submit, missing mandatory fields: ${missing.join(", ")}`,
      );
    }

    const next = await this.pool.query(
      `UPDATE transfers SET
       status = 'SUBMITTED',
       submitted_by = $2,
       submitted_at = now(),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
      [id, resolveUserId(user)],
    );

    await this.audit(
      resolveUserId(user),
      "TRANSFER_SUBMIT",
      String(id),
      row,
      next.rows[0],
      ip,
    );

    // Auto monitoring evaluation — tidak boleh menggagalkan transfer.
    await this.monitoring.safeEvaluateTransfer(id, user);

    return next.rows[0];
  }

  // ---------------------------------------------------------------------------
  // COMPLIANCE REVIEW — helpers
  // ---------------------------------------------------------------------------
  /**
   * Ambil review compliance terbaru (by id desc) untuk sebuah transfer, sudah
   * dalam bentuk siap dikirim ke response. Mengembalikan null bila belum ada.
   */
  private async fetchLatestComplianceReview(transferId: number | string) {
    const { rows } = await this.pool.query(
      `SELECT id, transfer_id, status, red_flags, report_notes,
              reported_by, reported_at, reviewed_by, reviewed_at,
              decision_notes, created_at, updated_at
         FROM transfer_compliance_reviews
        WHERE transfer_id = $1
        ORDER BY id DESC
        LIMIT 1`,
      [transferId],
    );
    return rows[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // SUBMIT FOR COMPLIANCE REVIEW (Admin/Frontline) — DRAFT → PENDING_COMPLIANCE_REVIEW
  // ---------------------------------------------------------------------------
  async submitComplianceReview(
    id: number,
    user: AuthedUser,
    dto: SubmitComplianceReviewDto,
    ip?: string,
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [id]);
    if ((prev.rowCount ?? 0) === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    if (
      user.role !== "FrontDesk" &&
      !FULL_ACCESS_ROLES.includes(user.role)
    ) {
      throw new ForbiddenException(
        "Only FrontDesk can submit a transfer for compliance review",
      );
    }

    if (row.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya transfer berstatus DRAFT yang dapat diajukan untuk review compliance.",
      );
    }

    const redFlags = dto.red_flags ?? [];
    if (redFlags.length === 0) {
      throw new BadRequestException("red_flags wajib diisi dan tidak boleh kosong");
    }
    if (redFlags.includes("OTHER") && !dto.report_notes?.trim()) {
      throw new BadRequestException(
        "report_notes wajib diisi bila red_flags mengandung OTHER.",
      );
    }

    // Guard sender tetap APPROVED — konsisten dengan submit normal.
    await this.assertSenderApproved(row.sender_application_id);
    await this.assertWicTransferLimit(row.sender_application_id, row.amount);

    const actorId = resolveUserId(user);

    const next = await this.pool.query(
      `UPDATE transfers SET
         status='PENDING_COMPLIANCE_REVIEW',
         updated_at=now()
       WHERE id=$1
       RETURNING *`,
      [id],
    );

    await this.pool.query(
      `INSERT INTO transfer_compliance_reviews
         (transfer_id, status, red_flags, report_notes, reported_by, reported_at)
       VALUES ($1, 'OPEN', $2::jsonb, $3, $4, now())`,
      [id, JSON.stringify(redFlags), dto.report_notes ?? null, actorId],
    );

    await this.audit(
      actorId,
      "TRANSFER_SUBMIT_COMPLIANCE_REVIEW",
      String(id),
      row,
      next.rows[0],
      ip,
    );

    // Auto monitoring evaluation di submit-time — LTKT ≥ 500M harus terdeteksi
    // walau transfer masuk jalur PENDING_COMPLIANCE_REVIEW. Tidak boleh gagal.
    await this.monitoring.safeEvaluateTransfer(id, user);

    return this.getById(id, user);
  }

  // ---------------------------------------------------------------------------
  // COMPLIANCE REVIEW DECISION — ComplianceLead
  // ---------------------------------------------------------------------------
  async complianceReview(
    id: number,
    user: AuthedUser,
    dto: ComplianceReviewDecisionDto,
    ip?: string,
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [id]);
    if ((prev.rowCount ?? 0) === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    if (
      user.role !== "ComplianceLead" &&
      !FULL_ACCESS_ROLES.includes(user.role)
    ) {
      throw new ForbiddenException("Only ComplianceLead can decide compliance review");
    }

    if (row.status !== "PENDING_COMPLIANCE_REVIEW") {
      throw new BadRequestException(
        "Hanya transfer berstatus PENDING_COMPLIANCE_REVIEW yang dapat direview oleh Compliance.",
      );
    }

    const review = await this.fetchLatestComplianceReview(id);
    if (!review) {
      throw new BadRequestException(
        "Tidak ada review compliance aktif untuk transfer ini.",
      );
    }

    const actorId = resolveUserId(user);
    const notes = dto.decision_notes?.trim() || null;

    // decision_notes wajib untuk semua aksi kecuali APPROVE_TO_CONTINUE.
    if (dto.action !== "APPROVE_TO_CONTINUE" && !notes) {
      throw new BadRequestException("decision_notes wajib diisi untuk aksi ini.");
    }

    // Map aksi → status baris review + status transfer berikutnya.
    const REVIEW_STATUS: Record<string, string> = {
      APPROVE_TO_CONTINUE: "APPROVED_TO_CONTINUE",
      REJECT: "REJECTED",
      REQUEST_ADDITIONAL_INFO: "REQUEST_ADDITIONAL_INFO",
      REQUEST_EDD: "REQUEST_EDD",
      MARK_LTKM_CANDIDATE: "LTKM_CANDIDATE",
    };
    const reviewStatus = REVIEW_STATUS[dto.action];

    // Update baris review (in place) dengan keputusan + timestamp backend.
    await this.pool.query(
      `UPDATE transfer_compliance_reviews SET
         status=$2,
         reviewed_by=$3,
         reviewed_at=now(),
         decision_notes=$4,
         updated_at=now()
       WHERE id=$1`,
      [review.id, reviewStatus, actorId, notes],
    );

    let next;
    if (dto.action === "APPROVE_TO_CONTINUE") {
      // Lanjut ke alur normal — transfer boleh direview Operation Supervisor.
      next = await this.pool.query(
        `UPDATE transfers SET
           status='SUBMITTED',
           submitted_by=$2,
           submitted_at=now(),
           updated_at=now()
         WHERE id=$1
         RETURNING *`,
        [id, actorId],
      );
    } else if (dto.action === "REJECT") {
      next = await this.pool.query(
        `UPDATE transfers SET
           status='REJECTED',
           rejected_by=$2,
           rejected_at=now(),
           reject_reason=$3,
           updated_at=now()
         WHERE id=$1
         RETURNING *`,
        [id, actorId, notes],
      );
    } else {
      // REQUEST_ADDITIONAL_INFO / REQUEST_EDD / MARK_LTKM_CANDIDATE:
      // transfer tetap PENDING_COMPLIANCE_REVIEW (blocked dari Operation Supervisor)
      // sampai ComplianceLead melakukan APPROVE_TO_CONTINUE atau REJECT.
      next = await this.pool.query(
        `UPDATE transfers SET updated_at=now() WHERE id=$1 RETURNING *`,
        [id],
      );
    }

    // MARK_LTKM_CANDIDATE → buat/append monitoring case LTKM (BOTH bila sudah
    // ada LTKT). Hanya untuk aksi eksplisit ini, bukan setiap REJECT.
    if (dto.action === "MARK_LTKM_CANDIDATE") {
      await this.monitoring.safeMarkLtkmCandidate(
        id,
        { redFlags: review.red_flags ?? [], notes },
        user,
      );
    }

    await this.audit(
      actorId,
      `TRANSFER_COMPLIANCE_${reviewStatus}`,
      String(id),
      row,
      next.rows[0],
      ip,
    );

    return this.getById(id, user);
  }

  // ---------------------------------------------------------------------------
  // SUPERVISOR REVIEW (layer 1) — OperationSupervisor
  // ---------------------------------------------------------------------------
  async supervisorReview(
    id: number,
    user: AuthedUser,
    dto: { action: "APPROVE" | "REJECT"; notes?: string; reject_reason?: string },
    ip?: string,
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [id]);
    if ((prev.rowCount ?? 0) === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    if (row.status !== "SUBMITTED") {
      throw new BadRequestException(
        "Hanya transfer berstatus SUBMITTED yang dapat direview oleh Operation Supervisor.",
      );
    }

    const actorId = resolveUserId(user);

    let next;
    if (dto.action === "APPROVE") {
      next = await this.pool.query(
        `UPDATE transfers SET
          status='PENDING_FINANCE_STAFF_REVIEW',
          supervisor_reviewed_by=$2,
          supervisor_reviewed_at=now(),
          supervisor_notes=$3,
          updated_at=now()
        WHERE id=$1
        RETURNING *`,
        [id, actorId, dto.notes ?? null],
      );
    } else {
      next = await this.pool.query(
        `UPDATE transfers SET
          status='REJECTED',
          rejected_by=$2,
          rejected_at=now(),
          reject_reason=$3,
          supervisor_reviewed_by=$2,
          supervisor_reviewed_at=now(),
          supervisor_notes=$4,
          updated_at=now()
        WHERE id=$1
        RETURNING *`,
        [id, actorId, dto.reject_reason ?? null, dto.notes ?? null],
      );
    }

    await this.audit(actorId, "TRANSFER_SUPERVISOR_REVIEW", String(id), row, next.rows[0], ip);
    return next.rows[0];
  }

  // ---------------------------------------------------------------------------
  // FINANCE STAFF REVIEW (layer 2) — FinanceStaff
  // ---------------------------------------------------------------------------
  async financeReview(
    id: number,
    user: AuthedUser,
    dto: { action: "APPROVE" | "REJECT"; notes?: string; reject_reason?: string },
    ip?: string,
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [id]);
    if ((prev.rowCount ?? 0) === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    if (row.status !== "PENDING_FINANCE_STAFF_REVIEW") {
      throw new BadRequestException(
        "Hanya transfer berstatus PENDING_FINANCE_STAFF_REVIEW yang dapat direview oleh Finance Staff.",
      );
    }

    const actorId = resolveUserId(user);

    let next;
    if (dto.action === "APPROVE") {
      next = await this.pool.query(
        `UPDATE transfers SET
          status='PENDING_FINANCE_MANAGER_APPROVAL',
          finance_reviewed_by=$2,
          finance_reviewed_at=now(),
          finance_notes=$3,
          updated_at=now()
        WHERE id=$1
        RETURNING *`,
        [id, actorId, dto.notes ?? null],
      );
    } else {
      next = await this.pool.query(
        `UPDATE transfers SET
          status='REJECTED',
          rejected_by=$2,
          rejected_at=now(),
          reject_reason=$3,
          finance_reviewed_by=$2,
          finance_reviewed_at=now(),
          finance_notes=$4,
          updated_at=now()
        WHERE id=$1
        RETURNING *`,
        [id, actorId, dto.reject_reason ?? null, dto.notes ?? null],
      );
    }

    await this.audit(actorId, "TRANSFER_FINANCE_REVIEW", String(id), row, next.rows[0], ip);
    return next.rows[0];
  }

  // ---------------------------------------------------------------------------
  // DECIDE (APPROVE / REJECT) – FinanceManager
  // ---------------------------------------------------------------------------
  async decide(
    id: number,
    user: AuthedUser,
    dto: DecideTransferDto,
    ip?: string,
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [
      id,
    ]);
    const rowCount = prev.rowCount ?? 0;
    if (rowCount === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    if (user.role !== "FinanceManager" && !FULL_ACCESS_ROLES.includes(user.role)) {
      throw new ForbiddenException("Only FinanceManager can approve/reject");
    }

    if (FULL_ACCESS_ROLES.includes(user.role)) {
      if (!["SUBMITTED", "PENDING_FINANCE_MANAGER_APPROVAL"].includes(row.status)) {
        throw new BadRequestException(
          "Hanya transfer berstatus SUBMITTED atau PENDING_FINANCE_MANAGER_APPROVAL yang dapat diputuskan.",
        );
      }
    } else {
      // FinanceManager strict ordering — must go through OperationSupervisor + FinanceStaff first.
      if (row.status !== "PENDING_FINANCE_MANAGER_APPROVAL") {
        throw new BadRequestException(
          "Transfer harus melalui review OperationSupervisor dan FinanceStaff terlebih dahulu sebelum dapat diputuskan.",
        );
      }
    }

    const decisionNotes = dto.decision_notes ?? dto.note ?? null;
    const actorId = resolveUserId(user);

    let next;
    if (dto.decision === "APPROVE") {
      // FinanceManager final approval directly completes the transfer as SUCCESS.
      next = await this.pool.query(
        `UPDATE transfers SET
          status='COMPLETED',
          result='SUCCESS',
          approved_by=$2,
          approved_at=now(),
          completed_at=now(),
          decision_notes=$3,
          updated_at=now()
        WHERE id=$1
        RETURNING *`,
        [id, actorId, decisionNotes],
      );
    } else if (dto.decision === "REJECT") {
      next = await this.pool.query(
        `UPDATE transfers SET
          status='REJECTED',
          rejected_by=$2,
          rejected_at=now(),
          reject_reason=$3,
          decision_notes=$4,
          updated_at=now()
        WHERE id=$1
        RETURNING *`,
        [id, actorId, dto.reject_reason ?? null, decisionNotes],
      );
    } else {
      throw new BadRequestException("decision must be APPROVE or REJECT");
    }

    await this.audit(
      actorId,
      `TRANSFER_${next.rows[0].status}`,
      String(id),
      row,
      next.rows[0],
      ip,
    );
    return next.rows[0];
  }

  // ---------------------------------------------------------------------------
  // SET RESULT (SUCCESS/FAILED) – FinanceManager
  // ---------------------------------------------------------------------------
  async setResult(
    id: number,
    user: AuthedUser,
    dto: SetTransferResultDto,
    ip?: string,
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [
      id,
    ]);
    const rowCount = prev.rowCount ?? 0;
    if (rowCount === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    if (user.role !== "FinanceManager" && !FULL_ACCESS_ROLES.includes(user.role)) {
      throw new ForbiddenException("Only FinanceManager can set result");
    }

    if (!["APPROVED", "COMPLETED"].includes(row.status)) {
      throw new BadRequestException("Only APPROVED or COMPLETED can have result set");
    }

    if (dto.result !== "SUCCESS" && dto.result !== "FAILED") {
      throw new BadRequestException("result must be SUCCESS or FAILED");
    }

    const actorId = resolveUserId(user);
    const resultNotes = dto.result_notes ?? dto.note ?? null;
    const isSuccess = dto.result === "SUCCESS";

    const next = await this.pool.query(
      `UPDATE transfers SET
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
      RETURNING *`,
      [
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
      ],
    );

    await this.audit(
      actorId,
      "TRANSFER_SET_RESULT",
      String(id),
      row,
      next.rows[0],
      ip,
    );

    // Auto monitoring evaluation pada hasil SUCCESS — tidak boleh menggagalkan transfer.
    if (isSuccess) {
      await this.monitoring.safeEvaluateTransfer(id, user);
    }

    return next.rows[0];
  }

  // ---------------------------------------------------------------------------
  // LIST – FinanceStaff: hanya miliknya; FinanceManager/SystemAdmin: semua
  // ---------------------------------------------------------------------------
  async list(user: AuthedUser, status?: string) {
    const role = user.role;
    const params: any[] = [];
    let where = "WHERE 1=1";

    if (role === "FrontDesk") {
      // FrontDesk → hanya transfer yang dia buat sendiri
      params.push(resolveUserId(user));
      where += ` AND (t.created_by = $${params.length} OR t.created_by IS NULL)`;
    }
    // FinanceStaff, OperationSupervisor, FinanceManager, SystemAdmin, Director, Auditor → semua

    const normStatus = status?.toUpperCase();
    if (normStatus && normStatus !== "ALL") {
      params.push(normStatus);
      where += ` AND t.status = $${params.length}`;
    }

    const q = await this.pool.query(
      `SELECT
         t.id, t.partner_reference_no, t.reference_no, t.sender_application_id,
         t.amount, t.currency, t.amount_value, t.amount_currency,
         t.beneficiary_account_name, t.beneficiary_account_number,
         t.beneficiary_bank_code, t.beneficiary_bank_name,
         t.status, t.result, t.created_at, t.submitted_at, t.approved_at,
         t.completed_at, t.failed_at,
         t.source_of_funds, t.transaction_purpose,
         COALESCE(p.full_name, b.legal_name) AS sender_name,
         CASE WHEN p.cif_relationship_type = 'WIC' THEN NULL ELSE COALESCE(p.cif_no, b.cif_no) END AS sender_cif_no,
         p.cif_relationship_type AS sender_cif_relationship_type,
         a.type                              AS sender_type,
         cr.status                           AS compliance_review_status
       FROM transfers t
       LEFT JOIN applications a ON a.id = t.sender_application_id
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       LEFT JOIN LATERAL (
         SELECT status FROM transfer_compliance_reviews
          WHERE transfer_id = t.id ORDER BY id DESC LIMIT 1
       ) cr ON true
       ${where}
       ORDER BY t.id DESC
       LIMIT 200`,
      params,
    );

    return q.rows;
  }

  // ---------------------------------------------------------------------------
  // DETAIL
  // ---------------------------------------------------------------------------
  async getById(id: number, user: AuthedUser) {
    const isManager =
      user.role === "FinanceManager" ||
      user.role === "FinanceStaff" ||
      user.role === "OperationSupervisor" ||
      user.role === "ComplianceLead" ||
      user.role === "Auditor" ||
      FULL_ACCESS_ROLES.includes(user.role);

    const q = await this.pool.query(
      `SELECT t.*,
              COALESCE(p.full_name, b.legal_name) AS sender_name,
              CASE WHEN p.cif_relationship_type = 'WIC' THEN NULL ELSE COALESCE(p.cif_no, b.cif_no) END AS sender_cif_no,
              p.cif_relationship_type AS sender_cif_relationship_type,
              a.type                              AS sender_type
       FROM transfers t
       LEFT JOIN applications a ON a.id = t.sender_application_id
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       WHERE t.id=$1`,
      [id],
    );
    const rowCount = q.rowCount ?? 0;
    if (rowCount === 0) {
      throw new NotFoundException("Transfer not found");
    }

    const row = q.rows[0];

    // Non-manager hanya boleh lihat transfer yang dia buat.
    // pg mengembalikan BIGINT sebagai string → bandingkan sebagai string.
    if (!isManager) {
      const creatorId =
        row.created_by !== null && row.created_by !== undefined
          ? String(row.created_by)
          : null;
      const userId = String(resolveUserId(user));

      if (creatorId !== null && creatorId !== userId) {
        throw new ForbiddenException("Not allowed");
      }
    }

    // Sertakan review compliance terbaru (flagged transfer) bila ada.
    const latestReview = await this.fetchLatestComplianceReview(id);
    row.latest_compliance_review = latestReview
      ? {
          id: latestReview.id,
          status: latestReview.status,
          red_flags: latestReview.red_flags,
          report_notes: latestReview.report_notes,
          reported_by: latestReview.reported_by,
          reported_at: latestReview.reported_at,
          reviewed_by: latestReview.reviewed_by,
          reviewed_at: latestReview.reviewed_at,
          decision_notes: latestReview.decision_notes,
        }
      : null;
    row.compliance_review_status = latestReview ? latestReview.status : null;

    return row;
  }

  // ---------------------------------------------------------------------------
  // SNAP PREVIEW – pure mapping, NO external call
  // ---------------------------------------------------------------------------
  async snapPreview(id: number, user: AuthedUser) {
    const row = await this.getById(id, user);
    return buildSnapTransferPayload(row);
  }

  // ---------------------------------------------------------------------------
  // SENDER SEARCH — cari aplikasi APPROVED sebagai calon pengirim
  // ---------------------------------------------------------------------------
  async searchSenders(q = '', page = 1, limit = 20) {
    const pageN = Math.max(1, page);
    const limitN = Math.min(100, Math.max(1, limit));
    const offset = (pageN - 1) * limitN;
    const pattern = `%${q}%`;

    const countQ = await this.pool.query(
      `SELECT COUNT(*)::int AS total
       FROM applications a
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       WHERE a.status = 'APPROVED'
         AND ($1 = '' OR COALESCE(p.full_name, b.legal_name) ILIKE $2
              OR COALESCE(p.cif_no, b.cif_no) ILIKE $2
              OR COALESCE(p.cif_relationship_type, '') ILIKE $2
              OR COALESCE(p.identity_number, '') ILIKE $2
              OR COALESCE(b.nib, '') ILIKE $2
              OR COALESCE(b.npwp, '') ILIKE $2)`,
      [q, pattern],
    );

    const dataQ = await this.pool.query(
      `SELECT a.id AS application_id, a.type AS application_type, a.status,
              COALESCE(p.full_name, b.legal_name) AS display_name,
              CASE WHEN p.cif_relationship_type = 'WIC' THEN NULL ELSE COALESCE(p.cif_no, b.cif_no) END AS cif_no,
              p.cif_relationship_type,
              COALESCE(p.identity_number, b.nib) AS identity_number_or_business_number
       FROM applications a
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       WHERE a.status = 'APPROVED'
         AND ($1 = '' OR COALESCE(p.full_name, b.legal_name) ILIKE $2
              OR COALESCE(p.cif_no, b.cif_no) ILIKE $2
              OR COALESCE(p.cif_relationship_type, '') ILIKE $2
              OR COALESCE(p.identity_number, '') ILIKE $2
              OR COALESCE(b.nib, '') ILIKE $2
              OR COALESCE(b.npwp, '') ILIKE $2)
       ORDER BY a.id DESC
       LIMIT $3 OFFSET $4`,
      [q, pattern, limitN, offset],
    );

    return { data: dataQ.rows, page: pageN, limit: limitN, total: countQ.rows[0].total };
  }

  // ---------------------------------------------------------------------------
  // BANK CATALOG — daftar bank statis untuk FE dropdown
  // ---------------------------------------------------------------------------
  getBanks() {
    return [
      { code: 'BCA',     name: 'Bank Central Asia' },
      { code: 'MANDIRI', name: 'Bank Mandiri' },
      { code: 'BRI',     name: 'Bank Rakyat Indonesia' },
      { code: 'BNI',     name: 'Bank Negara Indonesia' },
      { code: 'CIMB',    name: 'CIMB Niaga' },
      { code: 'DANAMON', name: 'Bank Danamon' },
      { code: 'PERMATA', name: 'Bank Permata' },
      { code: 'BTN',     name: 'Bank Tabungan Negara' },
      { code: 'BSI',     name: 'Bank Syariah Indonesia' },
      { code: 'MAYBANK', name: 'Maybank Indonesia' },
      { code: 'OCBC',    name: 'OCBC Indonesia' },
      { code: 'PANIN',   name: 'Panin Bank' },
      { code: 'NOBU',    name: 'Bank Nobu' },
    ];
  }
}
