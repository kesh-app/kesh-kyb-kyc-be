import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Pool } from "pg";
import { resolveUserId } from "../../common/auth.util";
import { generateUniqueReferenceNo } from "../../common/reference-no.util";
import { NotificationsService } from "../notifications/notifications.service";
import {
  AmlReviewDto,
  CloseComplaintDto,
  ComplaintFinanceReviewDto,
  CooReviewDto,
  CreateComplaintDto,
  FinanceManagerReviewDto,
  ListComplaintsQueryDto,
  OperationInvestigationDto,
  ResolveComplaintDto,
  UpdateComplaintDto,
  VerifyComplaintDataDto,
} from "./dto";

type AuthedUser = { sub?: number | string; id?: number | string; role: string };

// Setiap status "kerja" complaint dipetakan ke role pemegang tongkat
// berikutnya — dipakai untuk broadcast ACTION_REQUIRED. null = belum ada
// endpoint yang men-transisi keluar dari status itu (mis. WAITING_BANK_CONFIRMATION)
// atau status terminal (CLOSED) — tidak ada yang perlu diberi tahu.
const COMPLAINT_STAGE_ROLE: Record<string, string | null> = {
  OPEN: "ComplaintHandling",
  WAITING_CUSTOMER_DATA: "ComplaintHandling",
  OPERATION_INVESTIGATION: "OperationSupervisor",
  WAITING_BANK_CONFIRMATION: "OperationSupervisor",
  COO_REVIEW: "COO",
  FINANCE_STAFF_REVIEW: "FinanceStaff",
  FINANCE_MANAGER_REVIEW: "FinanceManager",
  COMPLIANCE_REVIEW: "ComplianceLead",
  COMPLIANCE_HOLD: "ComplianceLead",
  COMPLAINT_HANDLING_FINALIZATION: "ComplaintHandling",
  AML_REVIEW: "ComplianceLead",
  AML_HOLD: "ComplianceLead",
  FINANCE_REVIEW: "FinanceStaff",
  REFUND_PROCESS: "FinanceStaff",
  RESOLVED: "ComplaintHandling",
  REJECTED: "ComplaintHandling",
  CLOSED: null,
};

/**
 * Tahap alur berbasis level (migration 0070). Tiket yang berada di salah satu
 * status ini sedang dipegang role lain — ComplaintHandling tidak boleh
 * menyelesaikannya dari luar giliran. Status legacy sengaja TIDAK masuk daftar
 * ini supaya tiket lama tetap bisa ditutup seperti sebelumnya.
 */
const LEVEL_FLOW_STAGES = [
  "COO_REVIEW",
  "FINANCE_STAFF_REVIEW",
  "FINANCE_MANAGER_REVIEW",
  "COMPLIANCE_REVIEW",
  "COMPLIANCE_HOLD",
];

/** Tujuan COO APPROVE — ditentukan complaint_level, bukan pilihan manual COO. */
const COO_APPROVE_ROUTING: Record<string, string> = {
  LEVEL_1: "COMPLAINT_HANDLING_FINALIZATION",
  LEVEL_2: "FINANCE_STAFF_REVIEW",
  LEVEL_3: "COMPLIANCE_REVIEW",
};

@Injectable()
export class ComplaintsService {
  constructor(
    @Inject("PG_POOL") private readonly pool: Pool,
    private readonly notifications: NotificationsService,
  ) {}

  // Semua aksi workflow melewati applyWorkflow(), jadi satu titik ini cukup
  // untuk menutup notifikasi tahap sebelumnya dan membuka yang baru — tidak
  // perlu diulang di tiap method verifyData/operationInvestigation/dst.
  private async notifyComplaintStage(id: number, complaintNo: string, status: string) {
    await this.notifications.resolveForObject("complaint", id);
    const role = COMPLAINT_STAGE_ROLE[status];
    if (!role) return;
    await this.notifications.notifyRole(role, "ACTION_REQUIRED", {
      objectType: "complaint",
      objectId: id,
      title: `Pengaduan ${complaintNo} — ${status.replace(/_/g, " ")}`,
      link: `/complaints/${id}`,
    });
  }

  /**
   * Nomor pengaduan baru: CMP-XXXXXXXX, tepat 12 karakter (lihat
   * common/reference-no.util). Nomor lama yang panjang tetap tersimpan apa
   * adanya dan tetap bisa dicari — pencarian memakai kecocokan persis.
   */
  private async resolveComplaintNo(): Promise<string> {
    const no = await generateUniqueReferenceNo("CMP", async (candidate) => {
      const dup = await this.pool.query(
        `SELECT 1 FROM complaints WHERE complaint_no = $1 LIMIT 1`,
        [candidate],
      );
      return (dup.rowCount ?? 0) > 0;
    });
    if (!no) {
      throw new BadRequestException("Failed to generate complaint_no, please retry");
    }
    return no;
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

    await this.notifyComplaintStage(result.rows[0].id, complaintNo, "OPEN");

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
              c.coo_decision, c.finance_manager_decision,
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
  /**
   * Status pengaduan yang dianggap SELESAI untuk keperluan resi cetak. Sisanya
   * (termasuk legacy IN_PROGRESS) dianggap masih berjalan. Dipakai hanya untuk
   * menurunkan receipt_state — TIDAK memengaruhi workflow.
   */
  private static readonly CLOSED_RECEIPT_STATUSES = [
    "RESOLVED",
    "CLOSED",
    "REJECTED",
  ];

  /**
   * OPEN vs CLOSED untuk footer resi. Daftar putih ada di sisi CLOSED supaya
   * status baru yang ditambahkan ke workflow otomatis dianggap masih berjalan
   * — resi pengaduan yang belum selesai adalah default yang aman.
   */
  private receiptState(status?: string | null): "OPEN" | "CLOSED" {
    return ComplaintsService.CLOSED_RECEIPT_STATUSES.includes(status ?? "")
      ? "CLOSED"
      : "OPEN";
  }

  async getById(id: number, _user?: AuthedUser) {
    const q = await this.pool.query(
      `SELECT c.*,
              COALESCE(u_created.name, u_created.email) AS created_by_name,
              COALESCE(u_verified.name, u_verified.email) AS data_verified_by_name,
              COALESCE(u_invest.name, u_invest.email) AS operation_investigated_by_name,
              COALESCE(u_aml.name, u_aml.email) AS aml_reviewed_by_name,
              -- Alias eksplisit: tahap COMPLIANCE_REVIEW alur level memakai
              -- kolom aml_* yang sama, jadi FE tidak perlu tahu nama lamanya.
              COALESCE(u_aml.name, u_aml.email) AS compliance_reviewed_by_name,
              c.aml_decision    AS compliance_decision,
              c.aml_notes       AS compliance_notes,
              c.aml_reviewed_at AS compliance_reviewed_at,
              COALESCE(u_finance.name, u_finance.email) AS finance_reviewed_by_name,
              COALESCE(u_coo.name, u_coo.email) AS coo_reviewed_by_name,
              COALESCE(u_fin_mgr.name, u_fin_mgr.email) AS finance_manager_reviewed_by_name,
              COALESCE(u_resolved.name, u_resolved.email) AS resolved_by_name,
              COALESCE(u_closed.name, u_closed.email) AS closed_by_name,
              COALESCE(p.phone, be.phone) AS customer_contact,
              t.amount AS transaction_amount,
              t.transaction_date AS transaction_date,
              t.status AS transaction_status,
              t.partner_reference_no AS transaction_partner_reference_no,
              -- Ringkasan nasabah & transaksi tertaut. Ada di sini supaya
              -- ComplaintHandling tidak perlu membuka /applications/:id atau
              -- /transfers/:id yang tidak boleh diaksesnya; aksesnya jadi
              -- ter-scope ke pengaduan, bukan ke seluruh tabel.
              app.public_id AS linked_application_public_id,
              app.status    AS linked_application_status,
              -- Sama seperti list aplikasi: override menang atas skor mentah.
              COALESCE(ar.override_level, ar.risk_level) AS linked_application_risk_level,
              t.public_id                  AS linked_transfer_public_id,
              t.beneficiary_account_name   AS linked_beneficiary_account_name,
              t.beneficiary_account_number AS linked_beneficiary_account_number,
              t.beneficiary_bank_name      AS linked_beneficiary_bank_name
         FROM complaints c
         LEFT JOIN users u_created ON u_created.id = c.created_by
         LEFT JOIN users u_verified ON u_verified.id = c.data_verified_by
         LEFT JOIN users u_invest ON u_invest.id = c.operation_investigated_by
         LEFT JOIN users u_aml ON u_aml.id = c.aml_reviewed_by
         LEFT JOIN users u_finance ON u_finance.id = c.finance_reviewed_by
         LEFT JOIN users u_coo ON u_coo.id = c.coo_reviewed_by
         LEFT JOIN users u_fin_mgr ON u_fin_mgr.id = c.finance_manager_reviewed_by
         LEFT JOIN users u_resolved ON u_resolved.id = c.resolved_by
         LEFT JOIN users u_closed ON u_closed.id = c.closed_by
         LEFT JOIN applications app ON app.id = c.customer_application_id
         LEFT JOIN persons p ON p.id = app.person_id
         LEFT JOIN business_entities be ON be.id = app.business_id
         LEFT JOIN application_risk ar ON ar.application_id = app.id
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

    // Kolom linked_* di atas dibungkus jadi dua objek ringkasan. Field lama
    // (customer_name, transaction_amount, dst.) sengaja tetap ada di root
    // supaya konsumen lama tidak perlu berubah — ini murni tambahan.
    const linked_customer = row.customer_application_id
      ? {
          application_id: row.customer_application_id,
          application_public_id: row.linked_application_public_id,
          cif_no: row.customer_cif_no,
          customer_name: row.customer_name,
          customer_type: row.customer_type,
          customer_status: row.linked_application_status,
          risk_level: row.linked_application_risk_level,
          contact: row.customer_contact,
        }
      : null;

    const linked_transfer = row.transaction_partner_reference_no
      ? {
          transfer_id: row.transfer_id,
          transfer_public_id: row.linked_transfer_public_id,
          partner_reference_no: row.transaction_partner_reference_no,
          amount: row.transaction_amount,
          transaction_date: row.transaction_date,
          status: row.transaction_status,
          beneficiary_account_name: row.linked_beneficiary_account_name,
          beneficiary_account_number: row.linked_beneficiary_account_number,
          beneficiary_bank_name: row.linked_beneficiary_bank_name,
        }
      : null;

    return {
      ...row,
      receipt_state: this.receiptState(row.status),
      linked_customer,
      linked_transfer,
      statement_refunds: refunds.rows,
    };
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
      // Level menentukan routing setelah COO. Mengubahnya di tengah jalan akan
      // membelokkan tiket yang sudah berjalan tanpa jejak, jadi hanya boleh
      // selagi tiket masih di tangan ComplaintHandling. SystemAdmin/Director
      // tetap punya kewenangan administratif seperti kebijakan yang berlaku.
      const isAdmin = user.role === "SystemAdmin" || user.role === "Director";
      if (
        !isAdmin &&
        !["OPEN", "WAITING_CUSTOMER_DATA"].includes(existing.status)
      ) {
        throw new BadRequestException(
          "Complaint level terkunci setelah investigasi operasional dimulai.",
        );
      }
      sets.push(`complaint_level = ${addField(dto.complaint_level)}`);
      sets.push(
        `level_3_risk_category = ${addField(
          dto.complaint_level === "LEVEL_3" ? dto.level_3_risk_category : null,
        )}`,
      );
    }
    // Tidak ada penulisan `status` di sini — lihat UpdateComplaintDto. PATCH
    // generik hanya untuk metadata tiket; perpindahan tahap wajib lewat
    // endpoint workflow supaya jejak keputusan/aktor/waktunya tidak hilang.

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
    const row = await this.getById(id);
    await this.notifyComplaintStage(id, row.complaint_no, row.status);
    return row;
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
    if (
      existing.status !== "OPERATION_INVESTIGATION" &&
      existing.status !== "WAITING_BANK_CONFIRMATION"
    ) {
      throw new BadRequestException(
        "Tahap investigasi operasional sudah selesai atau tidak tersedia.",
      );
    }
    const actorId = resolveUserId(user);

    // Alur berbasis level: supervisor tidak lagi memilih tujuan berikutnya —
    // setiap investigasi yang selesai naik ke COO, yang meneruskannya sesuai
    // complaint_level. PENDING tetap menunggu konfirmasi bank dan masih milik
    // supervisor (bisa disubmit ulang dari WAITING_BANK_CONFIRMATION).
    // Nilai result lama tetap diterima demi tiket & laporan historis.
    const nextStatus =
      dto.result === "PENDING" ? "WAITING_BANK_CONFIRMATION" : "COO_REVIEW";

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

  // Review COO — satu-satunya aksi COO. Tujuan APPROVE ditentukan
  // complaint_level, tidak pernah dipilih manual.
  async cooReview(id: number, user: AuthedUser, dto: CooReviewDto) {
    const existing = await this.loadOpen(id);
    if (existing.status !== "COO_REVIEW") {
      throw new BadRequestException(
        "Review COO hanya untuk complaint berstatus COO_REVIEW",
      );
    }
    const actorId = resolveUserId(user);

    let nextStatus: string;
    if (dto.decision === "RETURN_TO_SUPERVISOR") {
      // Hasil investigasi sebelumnya sengaja tidak dikosongkan — supervisor
      // memperbaiki di atas jejak lamanya, bukan mulai dari kosong.
      nextStatus = "OPERATION_INVESTIGATION";
    } else {
      nextStatus = COO_APPROVE_ROUTING[existing.complaint_level ?? ""] ?? "";
      if (!nextStatus) {
        throw new BadRequestException(
          "Complaint level belum ditetapkan — tidak dapat menentukan tahap berikutnya.",
        );
      }
    }

    return this.applyWorkflow(
      id,
      [
        "coo_decision = $2",
        "coo_notes = $3",
        "coo_reviewed_by = $4",
        "coo_reviewed_at = now()",
        "updated_by = $4",
        "status = $5",
      ],
      [id, dto.decision, dto.notes, actorId, nextStatus],
    );
  }

  // Review Finance Manager — hanya tahap FINANCE_MANAGER_REVIEW (LEVEL_2).
  // Menulis ke kolomnya sendiri; keputusan FinanceStaff tidak ditimpa.
  async financeManagerReview(
    id: number,
    user: AuthedUser,
    dto: FinanceManagerReviewDto,
  ) {
    const existing = await this.loadOpen(id);
    if (existing.status !== "FINANCE_MANAGER_REVIEW") {
      throw new BadRequestException(
        "Review Finance Manager hanya untuk complaint berstatus FINANCE_MANAGER_REVIEW",
      );
    }
    const actorId = resolveUserId(user);
    const nextStatus =
      dto.decision === "APPROVE"
        ? "COMPLAINT_HANDLING_FINALIZATION"
        : "FINANCE_STAFF_REVIEW";

    return this.applyWorkflow(
      id,
      [
        "finance_manager_decision = $2",
        "finance_manager_notes = $3",
        "finance_manager_reviewed_by = $4",
        "finance_manager_reviewed_at = now()",
        "updated_by = $4",
        "status = $5",
      ],
      [id, dto.decision, dto.notes, actorId, nextStatus],
    );
  }

  /**
   * Routing compliance per tahap. Status alur level dan status legacy tidak
   * pernah bertabrakan (COMPLIANCE_HOLD terpisah dari AML_HOLD), jadi status
   * saja sudah cukup menentukan alur mana yang berlaku — tidak perlu penanda
   * tambahan. Alur level: REJECT pun tidak menutup tiket, ComplaintHandling
   * yang mengomunikasikan hasilnya lalu menutup.
   */
  private static readonly COMPLIANCE_ROUTING: Record<string, Record<string, string>> = {
    COMPLIANCE_REVIEW: {
      APPROVE: "COMPLAINT_HANDLING_FINALIZATION",
      REJECT: "COMPLAINT_HANDLING_FINALIZATION",
      HOLD: "COMPLIANCE_HOLD",
      RETURN: "COO_REVIEW",
    },
    COMPLIANCE_HOLD: {
      RESUME: "COMPLIANCE_REVIEW",
    },
    // Legacy — tidak berubah sejak sebelum migration 0070.
    AML_REVIEW: {
      APPROVE: "OPERATION_INVESTIGATION",
      REJECT: "REJECTED",
      HOLD: "AML_HOLD",
    },
    AML_HOLD: {
      APPROVE: "OPERATION_INVESTIGATION",
      REJECT: "REJECTED",
      HOLD: "AML_HOLD",
    },
  };

  // Compliance review — ComplianceLead. Melayani tahap COMPLIANCE_REVIEW /
  // COMPLIANCE_HOLD (alur level) maupun AML_REVIEW / AML_HOLD (legacy) dengan
  // kolom audit yang sama.
  async amlReview(id: number, user: AuthedUser, dto: AmlReviewDto) {
    const existing = await this.loadOpen(id);
    const routing = ComplaintsService.COMPLIANCE_ROUTING[existing.status];
    if (!routing) {
      throw new BadRequestException(
        "Compliance review hanya untuk complaint berstatus COMPLIANCE_REVIEW, COMPLIANCE_HOLD, AML_REVIEW, atau AML_HOLD",
      );
    }
    const nextStatus = routing[dto.decision];
    if (!nextStatus) {
      throw new BadRequestException(
        `Keputusan compliance pada tahap ${existing.status} harus salah satu dari: ${Object.keys(routing).join(", ")}`,
      );
    }
    const actorId = resolveUserId(user);

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

  // Finance review — FinanceStaff. Melayani tahap FINANCE_STAFF_REVIEW (alur
  // level, lanjut ke FinanceManager) maupun FINANCE_REVIEW/REFUND_PROCESS
  // (legacy). Approval refund tetap di modul statement-refunds.
  async financeReview(id: number, user: AuthedUser, dto: ComplaintFinanceReviewDto) {
    const existing = await this.loadOpen(id);
    const levelFlow = existing.status === "FINANCE_STAFF_REVIEW";
    if (
      !levelFlow &&
      existing.status !== "FINANCE_REVIEW" &&
      existing.status !== "REFUND_PROCESS"
    ) {
      throw new BadRequestException(
        "Finance review hanya untuk complaint berstatus FINANCE_STAFF_REVIEW, FINANCE_REVIEW, atau REFUND_PROCESS",
      );
    }
    // Kosakata keputusan berbeda per tahap — jangan biarkan nilai legacy masuk
    // ke alur level (atau sebaliknya) dan menghasilkan jejak audit yang rancu.
    const allowed = levelFlow
      ? ["APPROVE", "RETURN"]
      : ["NO_REFUND", "REFUND_REQUIRED"];
    if (!allowed.includes(dto.decision)) {
      throw new BadRequestException(
        `Keputusan finance pada tahap ${existing.status} harus salah satu dari: ${allowed.join(", ")}`,
      );
    }
    const actorId = resolveUserId(user);
    // RETURN kembali ke COO — koreksi yang diminta Finance adalah koreksi
    // keputusan, bukan permintaan data nasabah baru, jadi tidak dilempar ke
    // ComplaintHandling.
    const nextStatus = levelFlow
      ? dto.decision === "APPROVE"
        ? "FINANCE_MANAGER_REVIEW"
        : "COO_REVIEW"
      : dto.decision === "REFUND_REQUIRED"
        ? "REFUND_PROCESS"
        : "RESOLVED";

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
    const existing = await this.loadOpen(id);
    // Tiket yang sedang dipegang COO/Finance/Compliance tidak boleh
    // diselesaikan mendahului gilirannya. Status legacy tidak dibatasi supaya
    // tiket lama tetap bisa ditutup seperti sebelum migrasi 0070.
    if (LEVEL_FLOW_STAGES.includes(existing.status)) {
      throw new BadRequestException(
        `Pengaduan masih menunggu keputusan tahap ${existing.status} — belum dapat diselesaikan.`,
      );
    }
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
