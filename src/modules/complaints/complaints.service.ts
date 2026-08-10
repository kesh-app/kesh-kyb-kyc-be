import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Pool } from "pg";
import { resolveUserId } from "../../common/auth.util";
import {
  AmlReviewDto,
  CloseComplaintDto,
  ComplaintFinanceReviewDto,
  CreateComplaintDto,
  ListComplaintsQueryDto,
  OperationInvestigationDto,
  ResolveComplaintDto,
  UpdateComplaintDto,
  VerifyComplaintDataDto,
} from "./dto";

type AuthedUser = { sub?: number | string; id?: number | string; role: string };

@Injectable()
export class ComplaintsService {
  constructor(@Inject("PG_POOL") private readonly pool: Pool) {}

  private generateComplaintNo(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.random().toString(36).toUpperCase().slice(2, 7).padEnd(5, "0");
    return `KESH-CMP-${date}-${rand}`;
  }

  private async resolveComplaintNo(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const candidate = this.generateComplaintNo();
      const dup = await this.pool.query(
        `SELECT 1 FROM complaints WHERE complaint_no = $1 LIMIT 1`,
        [candidate],
      );
      if ((dup.rowCount ?? 0) === 0) return candidate;
    }
    throw new BadRequestException("Failed to generate complaint_no, please retry");
  }

  // ---------------------------------------------------------------------------
  // SEARCH APPROVED CUSTOMERS
  // ---------------------------------------------------------------------------
  async searchCustomers(q = "", page = 1, limit = 20) {
    const pageN = Math.max(1, page);
    const limitN = Math.min(100, Math.max(1, limit));
    const offset = (pageN - 1) * limitN;
    const pattern = `%${q}%`;

    const base = `
      FROM applications a
      LEFT JOIN persons p ON p.id = a.person_id
      LEFT JOIN business_entities b ON b.id = a.business_id
      WHERE a.status = 'APPROVED'
        AND ($1 = '' OR COALESCE(p.full_name, b.legal_name) ILIKE $2
             OR COALESCE(p.cif_no, b.cif_no) ILIKE $2
             OR COALESCE(p.identity_number, '') ILIKE $2
             OR COALESCE(b.nib, '') ILIKE $2
             OR COALESCE(b.npwp, '') ILIKE $2)`;

    const countQ = await this.pool.query(
      `SELECT COUNT(*)::int AS total ${base}`,
      [q, pattern],
    );

    const dataQ = await this.pool.query(
      `SELECT
         a.id AS application_id,
         a.type AS customer_type,
         COALESCE(p.cif_no, b.cif_no) AS cif_no,
         COALESCE(p.full_name, b.legal_name) AS display_name
       ${base}
       ORDER BY a.created_at DESC
       LIMIT $3 OFFSET $4`,
      [q, pattern, limitN, offset],
    );

    return {
      data: dataQ.rows,
      total: countQ.rows[0].total,
      page: pageN,
      limit: limitN,
    };
  }

  // ---------------------------------------------------------------------------
  // SEARCH TRANSACTIONS (transfers) for a customer
  // ---------------------------------------------------------------------------
  async searchTransactions(customerAppId: number, q = "", page = 1, limit = 20) {
    const pageN = Math.max(1, page);
    const limitN = Math.min(100, Math.max(1, limit));
    const offset = (pageN - 1) * limitN;
    const pattern = `%${q}%`;
    const qStr = String(q);

    const base = `
      FROM transfers t
      WHERE t.sender_application_id = $1
        AND ($2 = '' OR t.partner_reference_no ILIKE $3
             OR COALESCE(t.reference_no,'') ILIKE $3
             OR COALESCE(t.external_reference_no,'') ILIKE $3
             OR COALESCE(t.bank_reference_no,'') ILIKE $3
             OR COALESCE(t.provider_reference_no,'') ILIKE $3
             OR t.id::text = $2)`;

    const countQ = await this.pool.query(
      `SELECT COUNT(*)::int AS total ${base}`,
      [customerAppId, qStr, pattern],
    );

    const dataQ = await this.pool.query(
      `SELECT
         t.id AS transfer_id,
         t.partner_reference_no AS transaction_reference,
         t.amount,
         t.currency,
         t.status,
         t.result,
         t.created_at
       ${base}
       ORDER BY t.created_at DESC
       LIMIT $4 OFFSET $5`,
      [customerAppId, qStr, pattern, limitN, offset],
    );

    return {
      data: dataQ.rows,
      total: countQ.rows[0].total,
      page: pageN,
      limit: limitN,
    };
  }

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------
  async create(user: AuthedUser, dto: CreateComplaintDto) {
    const appQ = await this.pool.query(
      `SELECT a.id, a.status, a.type,
              COALESCE(p.cif_no, b.cif_no) AS cif_no,
              COALESCE(p.full_name, b.legal_name) AS display_name
       FROM applications a
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       WHERE a.id = $1`,
      [dto.customer_application_id],
    );

    if (!appQ.rows[0]) {
      throw new BadRequestException("Customer application not found");
    }
    const app = appQ.rows[0];
    if (app.status !== "APPROVED") {
      throw new BadRequestException("Customer application must be APPROVED");
    }

    if (dto.transfer_id) {
      const tQ = await this.pool.query(
        `SELECT id FROM transfers WHERE id = $1 LIMIT 1`,
        [dto.transfer_id],
      );
      if (!tQ.rows[0]) {
        throw new BadRequestException("Transfer not found");
      }
    }

    const complaintNo = await this.resolveComplaintNo();
    const actorId = resolveUserId(user);

    const result = await this.pool.query(
      `INSERT INTO complaints (
         complaint_no, customer_application_id, customer_cif_no, customer_name, customer_type,
         transfer_id, transaction_reference, category, channel, priority,
         complaint_level, level_3_risk_category,
         complaint_notes, status, created_by, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'OPEN',$14,now())
       RETURNING *`,
      [
        complaintNo,
        dto.customer_application_id,
        app.cif_no ?? null,
        app.display_name,
        app.type ?? null,
        dto.transfer_id ?? null,
        dto.transaction_reference,
        dto.category ?? "TRANSFER",
        dto.channel ?? "WALK_IN",
        dto.priority ?? "MEDIUM",
        dto.complaint_level,
        // kategori risiko hanya relevan untuk LEVEL_3 — level lain diabaikan
        dto.complaint_level === "LEVEL_3" ? dto.level_3_risk_category : null,
        dto.complaint_notes,
        actorId,
      ],
    );

    return result.rows[0];
  }

  // ---------------------------------------------------------------------------
  // LIST
  // ---------------------------------------------------------------------------
  // Semua role yang diizinkan melihat seluruh complaint (tidak ada filter ownership):
  // satu tiket dikerjakan bergiliran oleh ComplaintHandling → Operation → Compliance → Finance.
  async list(user: AuthedUser, query: ListComplaintsQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const offset = (page - 1) * limit;

    const params: any[] = [];
    const conditions: string[] = [];

    if (query.complaint_level) {
      params.push(query.complaint_level);
      conditions.push(`c.complaint_level = $${params.length}`);
    }

    if (query.status) {
      params.push(query.status.toUpperCase());
      conditions.push(`c.status = $${params.length}`);
    }

    if (query.customer_application_id) {
      params.push(query.customer_application_id);
      conditions.push(`c.customer_application_id = $${params.length}`);
    }

    if (query.q) {
      params.push(`%${query.q}%`);
      const p = `$${params.length}`;
      conditions.push(
        `(c.complaint_no ILIKE ${p} OR c.customer_name ILIKE ${p} OR c.transaction_reference ILIKE ${p} OR c.customer_cif_no ILIKE ${p})`,
      );
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countQ = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM complaints c ${where}`,
      params,
    );

    const dataQ = await this.pool.query(
      `SELECT c.id, c.public_id, c.complaint_no, c.customer_application_id, c.customer_cif_no,
              c.customer_name, c.customer_type, c.transfer_id, c.transaction_reference,
              c.category, c.channel, c.priority, c.status,
              c.complaint_level, c.level_3_risk_category,
              c.data_verification_status, c.operation_investigation_result,
              c.aml_decision, c.finance_decision,
              c.resolution_notes, c.created_by, c.resolved_at, c.closed_at,
              c.created_at, c.updated_at
       FROM complaints c ${where}
       ORDER BY c.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    return {
      data: dataQ.rows,
      total: countQ.rows[0].total,
      page,
      limit,
    };
  }

  // ---------------------------------------------------------------------------
  // DETAIL
  // ---------------------------------------------------------------------------
  async getById(id: number, _user?: AuthedUser) {
    const q = await this.pool.query(
      `SELECT c.*,
              COALESCE(u_created.name, u_created.email) AS created_by_name,
              COALESCE(u_verified.name, u_verified.email) AS data_verified_by_name,
              COALESCE(u_invest.name, u_invest.email) AS operation_investigated_by_name,
              COALESCE(u_aml.name, u_aml.email) AS aml_reviewed_by_name,
              COALESCE(u_finance.name, u_finance.email) AS finance_reviewed_by_name,
              COALESCE(u_resolved.name, u_resolved.email) AS resolved_by_name,
              COALESCE(u_closed.name, u_closed.email) AS closed_by_name,
              COALESCE(p.phone, be.phone) AS customer_contact,
              t.amount AS transaction_amount,
              t.transaction_date AS transaction_date,
              t.status AS transaction_status,
              t.partner_reference_no AS transaction_partner_reference_no
         FROM complaints c
         LEFT JOIN users u_created ON u_created.id = c.created_by
         LEFT JOIN users u_verified ON u_verified.id = c.data_verified_by
         LEFT JOIN users u_invest ON u_invest.id = c.operation_investigated_by
         LEFT JOIN users u_aml ON u_aml.id = c.aml_reviewed_by
         LEFT JOIN users u_finance ON u_finance.id = c.finance_reviewed_by
         LEFT JOIN users u_resolved ON u_resolved.id = c.resolved_by
         LEFT JOIN users u_closed ON u_closed.id = c.closed_by
         LEFT JOIN applications app ON app.id = c.customer_application_id
         LEFT JOIN persons p ON p.id = app.person_id
         LEFT JOIN business_entities be ON be.id = app.business_id
         LEFT JOIN transfers t ON t.id = c.transfer_id
              OR (c.transfer_id IS NULL AND t.partner_reference_no = c.transaction_reference)
        WHERE c.id = $1`,
      [id],
    );

    if (!q.rows[0]) throw new NotFoundException("Complaint not found");
    const row = q.rows[0];

    // Refund yang tertaut — read-only. Complaint TIDAK ditutup otomatis oleh refund
    // (dibuat maupun disetujui); penutupan tetap manual lewat POST /complaints/:id/close
    // oleh ComplaintHandling setelah nasabah diberi tahu.
    const refunds = await this.pool.query(
      `SELECT id, refund_no, amount, currency, status, statement_date, received_at,
              original_transfer_id, approved_at, credited_at
         FROM statement_refunds
        WHERE complaint_id = $1
        ORDER BY id DESC`,
      [id],
    );

    return { ...row, statement_refunds: refunds.rows };
  }

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------
  async update(id: number, user: AuthedUser, dto: UpdateComplaintDto) {
    const existing = await this.getById(id);
    if (existing.status === "CLOSED") {
      throw new BadRequestException("Complaint sudah CLOSED dan tidak dapat diubah");
    }

    const actorId = resolveUserId(user);
    const params: any[] = [id]; // $1 → WHERE id = $1
    const sets: string[] = ["updated_at = now()"];

    const addField = (val: any): string => {
      params.push(val);
      return `$${params.length}`;
    };

    sets.push(`updated_by = ${addField(actorId)}`);

    if (dto.category !== undefined) sets.push(`category = ${addField(dto.category)}`);
    if (dto.channel !== undefined) sets.push(`channel = ${addField(dto.channel)}`);
    if (dto.priority !== undefined) sets.push(`priority = ${addField(dto.priority)}`);
    if (dto.complaint_notes !== undefined) sets.push(`complaint_notes = ${addField(dto.complaint_notes)}`);
    if (dto.resolution_notes !== undefined) sets.push(`resolution_notes = ${addField(dto.resolution_notes)}`);
    if (dto.customer_communication_notes !== undefined) {
      sets.push(`customer_communication_notes = ${addField(dto.customer_communication_notes)}`);
    }
    if (dto.complaint_level !== undefined) {
      sets.push(`complaint_level = ${addField(dto.complaint_level)}`);
      sets.push(
        `level_3_risk_category = ${addField(
          dto.complaint_level === "LEVEL_3" ? dto.level_3_risk_category : null,
        )}`,
      );
    }
    if (dto.status !== undefined) {
      sets.push(`status = ${addField(dto.status)}`);
      if (dto.status === "RESOLVED") {
        sets.push(`resolved_by = ${addField(actorId)}`);
        sets.push(`resolved_at = now()`);
      }
    }

    const result = await this.pool.query(
      `UPDATE complaints SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
      params,
    );

    return result.rows[0];
  }

  // ---------------------------------------------------------------------------
  // WORKFLOW ACTIONS
  // ---------------------------------------------------------------------------
  // Setiap aksi: ambil complaint, tolak kalau sudah final, tulis hasil + audit,
  // lalu pindahkan status sesuai routing yang disepakati bisnis.
  // RESOLVED = menunggu penutupan, bukan state kerja: satu-satunya aksi yang
  // tersisa untuk RESOLVED/REJECTED adalah close(). CLOSED tidak bisa apa-apa lagi.
  private static readonly LOCKED_STATUSES = ["RESOLVED", "REJECTED", "CLOSED"];

  private async loadOpen(id: number) {
    const row = await this.getById(id);
    if (ComplaintsService.LOCKED_STATUSES.includes(row.status)) {
      throw new BadRequestException(
        `Complaint sudah ${row.status} — tidak dapat diproses lagi`,
      );
    }
    return row;
  }

  private async applyWorkflow(id: number, sets: string[], params: any[]) {
    await this.pool.query(
      `UPDATE complaints SET ${["updated_at = now()", ...sets].join(", ")} WHERE id = $1`,
      params,
    );
    // getById() sudah mengembalikan bentuk actor-name-enriched — pakai ulang
    // supaya aksi workflow tidak perlu di-refetch terpisah oleh FE.
    return this.getById(id);
  }

  // Verifikasi kelengkapan data nasabah — ComplaintHandling
  async verifyData(id: number, user: AuthedUser, dto: VerifyComplaintDataDto) {
    const existing = await this.loadOpen(id);
    if (!["OPEN", "WAITING_CUSTOMER_DATA"].includes(existing.status)) {
      throw new BadRequestException(
        "Verifikasi data hanya untuk complaint berstatus OPEN atau WAITING_CUSTOMER_DATA.",
      );
    }
    const actorId = resolveUserId(user);
    const nextStatus =
      dto.data_verification_status === "COMPLETE"
        ? "OPERATION_INVESTIGATION"
        : "WAITING_CUSTOMER_DATA";

    return this.applyWorkflow(
      id,
      [
        "data_verification_status = $2",
        "data_verification_notes = $3",
        "data_verified_by = $4",
        "data_verified_at = now()",
        "updated_by = $4",
        "status = $5",
      ],
      [id, dto.data_verification_status, dto.notes ?? null, actorId, nextStatus],
    );
  }

  // Investigasi transaksi — OperationSupervisor. Tidak pernah membuat refund.
  async operationInvestigation(
    id: number,
    user: AuthedUser,
    dto: OperationInvestigationDto,
  ) {
    const existing = await this.loadOpen(id);
    if (existing.status !== "OPERATION_INVESTIGATION") {
      throw new BadRequestException(
        "Tahap investigasi operasional sudah selesai atau tidak tersedia.",
      );
    }
    const actorId = resolveUserId(user);

    const routing: Record<string, string | null> = {
      SUCCESS: "RESOLVED",
      PENDING: "WAITING_BANK_CONFIRMATION",
      FAILED: null, // status tetap; ComplaintHandling yang menyelesaikan manual
      RETURNED: "FINANCE_REVIEW",
      NEED_AML_REVIEW: "AML_REVIEW",
      NEED_FINANCE_REVIEW: "FINANCE_REVIEW",
    };
    const nextStatus = routing[dto.result] ?? existing.status;

    return this.applyWorkflow(
      id,
      [
        "operation_investigation_result = $2",
        "operation_investigation_notes = $3",
        "operation_investigated_by = $4",
        "operation_investigated_at = now()",
        "updated_by = $4",
        "status = $5",
      ],
      [id, dto.result, dto.notes, actorId, nextStatus],
    );
  }

  // AML / Compliance review — ComplianceLead
  async amlReview(id: number, user: AuthedUser, dto: AmlReviewDto) {
    const existing = await this.loadOpen(id);
    if (existing.status !== "AML_REVIEW" && existing.status !== "AML_HOLD") {
      throw new BadRequestException(
        "AML review hanya untuk complaint berstatus AML_REVIEW atau AML_HOLD",
      );
    }
    const actorId = resolveUserId(user);
    const nextStatus =
      dto.decision === "REJECT"
        ? "REJECTED"
        : dto.decision === "HOLD"
          ? "AML_HOLD"
          : "OPERATION_INVESTIGATION";

    return this.applyWorkflow(
      id,
      [
        "aml_decision = $2",
        "aml_notes = $3",
        "aml_reviewed_by = $4",
        "aml_reviewed_at = now()",
        "updated_by = $4",
        "status = $5",
      ],
      [id, dto.decision, dto.notes, actorId, nextStatus],
    );
  }

  // Finance review — FinanceStaff. Approval refund tetap di modul statement-refunds.
  async financeReview(id: number, user: AuthedUser, dto: ComplaintFinanceReviewDto) {
    const existing = await this.loadOpen(id);
    if (existing.status !== "FINANCE_REVIEW" && existing.status !== "REFUND_PROCESS") {
      throw new BadRequestException(
        "Finance review hanya untuk complaint berstatus FINANCE_REVIEW atau REFUND_PROCESS",
      );
    }
    const actorId = resolveUserId(user);
    const nextStatus = dto.decision === "REFUND_REQUIRED" ? "REFUND_PROCESS" : "RESOLVED";

    return this.applyWorkflow(
      id,
      [
        "finance_decision = $2",
        "finance_review_notes = $3",
        "finance_reviewed_by = $4",
        "finance_reviewed_at = now()",
        "updated_by = $4",
        "status = $5",
      ],
      [id, dto.decision, dto.notes, actorId, nextStatus],
    );
  }

  // Resolve — ComplaintHandling, setelah nasabah diinformasikan
  async resolve(id: number, user: AuthedUser, dto: ResolveComplaintDto) {
    await this.loadOpen(id);
    const actorId = resolveUserId(user);

    return this.applyWorkflow(
      id,
      [
        "resolution_notes = $2",
        "customer_communication_notes = COALESCE($3, customer_communication_notes)",
        "resolved_by = $4",
        "resolved_at = now()",
        "updated_by = $4",
        "status = 'RESOLVED'",
      ],
      [id, dto.resolution_notes, dto.customer_communication_notes ?? null, actorId],
    );
  }

  // Close — ComplaintHandling. Tidak pernah otomatis karena refund.
  async close(id: number, user: AuthedUser, dto: CloseComplaintDto) {
    const existing = await this.getById(id);
    if (existing.status !== "RESOLVED" && existing.status !== "REJECTED") {
      throw new BadRequestException(
        "Hanya complaint berstatus RESOLVED atau REJECTED yang dapat ditutup",
      );
    }
    const actorId = resolveUserId(user);

    return this.applyWorkflow(
      id,
      [
        "closing_notes = $2",
        "closed_by = $3",
        "closed_at = now()",
        "updated_by = $3",
        "status = 'CLOSED'",
      ],
      [id, dto.closing_notes, actorId],
    );
  }
}
