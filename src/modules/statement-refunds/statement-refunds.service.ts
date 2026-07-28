import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Pool } from "pg";
import { resolveUserId } from "../../common/auth.util";
import {
  CreateStatementRefundDto,
  ListStatementRefundsQueryDto,
  MatchStatementRefundDto,
  StatementRefundDecisionDto,
  UpdateStatementRefundDto,
} from "./dto";

type AuthedUser = { sub?: number | string; id?: number | string; role: string };

// Status yang sudah final/terkunci — pencatatan tidak boleh diubah lagi.
const LOCKED_STATUSES = ["APPROVED", "BALANCE_CREDITED", "REJECTED"];

@Injectable()
export class StatementRefundsService {
  constructor(@Inject("PG_POOL") private readonly pool: Pool) {}

  private async resolveRefundNo(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const rand = Math.random().toString(36).toUpperCase().slice(2, 7).padEnd(5, "0");
      const candidate = `KESH-RFD-${date}-${rand}`;
      const dup = await this.pool.query(
        `SELECT 1 FROM statement_refunds WHERE refund_no = $1 LIMIT 1`,
        [candidate],
      );
      if ((dup.rowCount ?? 0) === 0) return candidate;
    }
    throw new BadRequestException("Failed to generate refund_no, please retry");
  }

  private async fetchRefund(id: number) {
    const { rows } = await this.pool.query(
      `SELECT * FROM statement_refunds WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException("Statement refund not found");
    return rows[0];
  }

  private async fetchTransfer(transferId: number) {
    const { rows } = await this.pool.query(
      `SELECT t.id, t.amount, t.currency, t.status, t.result,
              t.sender_application_id,
              COALESCE(t.reference_no, t.partner_reference_no) AS reference_no,
              t.partner_reference_no, t.bank_reference_no,
              t.beneficiary_account_number, t.beneficiary_account_name,
              t.beneficiary_bank_name, t.transaction_date, t.created_at
         FROM transfers t WHERE t.id = $1`,
      [transferId],
    );
    return rows[0] ?? null;
  }

  /**
   * Duplikat = mutasi bank yang sama (rekening + referensi + nominal + waktu terima).
   * Referensi bank kosong tetap dicek di sini karena unique index hanya aktif
   * saat bank_reference_no terisi.
   */
  private async findDuplicate(v: {
    bank_account_no?: string | null;
    bank_reference_no?: string | null;
    amount: number;
    received_at: string;
  }) {
    const { rows } = await this.pool.query(
      `SELECT id, refund_no, status FROM statement_refunds
        WHERE COALESCE(bank_account_no,'') = COALESCE($1,'')
          AND COALESCE(bank_reference_no,'') = COALESCE($2,'')
          AND amount = $3
          AND received_at = $4::timestamptz
        LIMIT 1`,
      [
        v.bank_account_no ?? null,
        v.bank_reference_no ?? null,
        v.amount,
        v.received_at,
      ],
    );
    return rows[0] ?? null;
  }

  /**
   * Boundary integrasi saldo. Repo ini belum punya modul balance/balance_events,
   * jadi refund berhenti di APPROVED dan posting saldo dilakukan sistem lain.
   * Kalau modul balance sudah ada: buat balance event (type REFUND, credit =
   * amount) dalam satu transaksi, isi balance_event_id + credited_at, lalu ubah
   * status ke BALANCE_CREDITED.
   * ponytail: tidak ada balance service lokal — status berhenti di APPROVED,
   * jangan dipalsukan. Ganti helper ini saat modul balance tersedia.
   */
  private balanceCreditStatus(row: any): string | null {
    if (row.status === "BALANCE_CREDITED") return "CREDITED";
    if (row.status === "APPROVED") return "PENDING_EXTERNAL_POSTING";
    return null;
  }

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------
  async create(user: AuthedUser, dto: CreateStatementRefundDto) {
    if (!(Number(dto.amount) > 0)) {
      throw new BadRequestException("amount must be greater than 0");
    }

    if (dto.complaint_id) {
      const c = await this.pool.query(
        `SELECT id FROM complaints WHERE id = $1 LIMIT 1`,
        [dto.complaint_id],
      );
      if (!c.rows[0]) throw new BadRequestException("Complaint not found");
    }

    const dup = await this.findDuplicate({
      bank_account_no: dto.bank_account_no ?? null,
      bank_reference_no: dto.bank_reference_no ?? null,
      amount: dto.amount,
      received_at: dto.received_at,
    });
    if (dup) {
      throw new ConflictException(
        `Mutasi refund yang sama sudah tercatat pada ${dup.refund_no}`,
      );
    }

    // Transfer asal opsional saat create — refund bisa ditemukan dari rekonsiliasi.
    let transfer: any = null;
    if (dto.original_transfer_id) {
      transfer = await this.fetchTransfer(dto.original_transfer_id);
      if (!transfer) throw new BadRequestException("Transfer not found");
    }

    const exactAmount =
      transfer && Number(transfer.amount) === Number(dto.amount);
    const status = transfer ? (exactAmount ? "MATCHED" : "NEED_INVESTIGATION") : "UNMATCHED";

    const { rows } = await this.pool.query(
      `INSERT INTO statement_refunds (
         refund_no, complaint_id, original_transfer_id, partner_application_id,
         statement_date, received_at, amount, currency,
         bank_account_no, bank_name, bank_reference_no, statement_description,
         evidence_uri, match_method, match_confidence, status,
         investigation_notes, created_by, matched_by, matched_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,now())
       RETURNING *`,
      [
        await this.resolveRefundNo(),
        dto.complaint_id ?? null,
        dto.original_transfer_id ?? null,
        transfer?.sender_application_id ?? null,
        dto.statement_date,
        dto.received_at,
        dto.amount,
        dto.currency ?? "IDR",
        dto.bank_account_no ?? null,
        dto.bank_name ?? null,
        dto.bank_reference_no ?? null,
        dto.statement_description ?? null,
        dto.evidence_uri ?? null,
        transfer ? "MANUAL" : null,
        transfer ? (exactAmount ? "HIGH" : "LOW") : null,
        status,
        dto.investigation_notes ?? null,
        resolveUserId(user),
        transfer ? resolveUserId(user) : null,
        transfer ? new Date().toISOString() : null,
      ],
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // LIST
  // ---------------------------------------------------------------------------
  async list(query: ListStatementRefundsQueryDto = {}) {
    const page = query.page ?? 1;
    const limit = Math.min(100, query.limit ?? 20);
    const offset = (page - 1) * limit;

    const params: any[] = [];
    const conditions: string[] = [];

    if (query.status) {
      params.push(query.status);
      conditions.push(`r.status = $${params.length}`);
    }
    if (query.partner_application_id) {
      params.push(query.partner_application_id);
      conditions.push(`r.partner_application_id = $${params.length}`);
    }
    if (query.statement_date_from) {
      params.push(query.statement_date_from);
      conditions.push(`r.statement_date >= $${params.length}::date`);
    }
    if (query.statement_date_to) {
      params.push(query.statement_date_to);
      conditions.push(`r.statement_date <= $${params.length}::date`);
    }
    if (query.received_from) {
      params.push(query.received_from);
      conditions.push(`r.received_at >= $${params.length}::timestamptz`);
    }
    if (query.received_to) {
      params.push(query.received_to);
      conditions.push(`r.received_at <= $${params.length}::timestamptz`);
    }
    if (query.q) {
      params.push(`%${query.q}%`);
      const p = `$${params.length}`;
      conditions.push(`(
        r.refund_no ILIKE ${p}
        OR COALESCE(r.bank_reference_no,'') ILIKE ${p}
        OR COALESCE(c.complaint_no,'') ILIKE ${p}
        OR COALESCE(t.reference_no, t.partner_reference_no, '') ILIKE ${p}
        OR COALESCE(p_.full_name, b.legal_name, '') ILIKE ${p}
      )`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const baseJoin = `
      FROM statement_refunds r
      LEFT JOIN complaints c ON c.id = r.complaint_id
      LEFT JOIN transfers t ON t.id = r.original_transfer_id
      LEFT JOIN applications a ON a.id = r.partner_application_id
      LEFT JOIN persons p_ ON p_.id = a.person_id
      LEFT JOIN business_entities b ON b.id = a.business_id
      ${where}
    `;

    const [{ rows }, { rows: countRows }] = await Promise.all([
      this.pool.query(
        `SELECT r.id, r.refund_no, c.complaint_no, r.original_transfer_id,
                COALESCE(t.reference_no, t.partner_reference_no) AS transfer_reference_no,
                COALESCE(p_.full_name, b.legal_name) AS partner_name,
                r.partner_application_id,
                r.statement_date, r.received_at, r.amount, r.currency,
                r.bank_reference_no, r.status, r.match_confidence,
                r.created_by, r.approved_by, r.created_at, r.updated_at
         ${baseJoin}
         ORDER BY r.received_at DESC, r.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      this.pool.query(`SELECT COUNT(*)::int AS total ${baseJoin}`, params),
    ]);

    return { data: rows, total: countRows[0].total, page, limit };
  }

  // ---------------------------------------------------------------------------
  // DETAIL
  // ---------------------------------------------------------------------------
  async getById(id: number) {
    const row = await this.fetchRefund(id);

    const complaint = row.complaint_id
      ? (
          await this.pool.query(
            `SELECT id, complaint_no, customer_name, transaction_reference, status,
                    resolution_notes, created_at
               FROM complaints WHERE id = $1`,
            [row.complaint_id],
          )
        ).rows[0] ?? null
      : null;

    const transfer = row.original_transfer_id
      ? await this.fetchTransfer(row.original_transfer_id)
      : null;

    const partner = row.partner_application_id
      ? (
          await this.pool.query(
            `SELECT a.id AS application_id, a.type AS customer_type,
                    COALESCE(p.cif_no, b.cif_no) AS cif_no,
                    COALESCE(p.full_name, b.legal_name) AS display_name
               FROM applications a
               LEFT JOIN persons p ON p.id = a.person_id
               LEFT JOIN business_entities b ON b.id = a.business_id
              WHERE a.id = $1`,
            [row.partner_application_id],
          )
        ).rows[0] ?? null
      : null;

    return {
      ...row,
      complaint,
      transfer,
      partner,
      // Modul balance belum ada di repo ini — lihat balanceCreditStatus().
      balance_event: null,
      balance_credit_status: this.balanceCreditStatus(row),
    };
  }

  // ---------------------------------------------------------------------------
  // UPDATE — hanya field pencatatan, dan hanya sebelum keputusan finance
  // ---------------------------------------------------------------------------
  async update(id: number, user: AuthedUser, dto: UpdateStatementRefundDto) {
    const row = await this.fetchRefund(id);
    if (LOCKED_STATUSES.includes(row.status) || row.status === "PENDING_APPROVAL") {
      throw new BadRequestException(
        `Refund berstatus ${row.status} tidak dapat diubah lagi.`,
      );
    }

    if (dto.complaint_id) {
      const c = await this.pool.query(
        `SELECT id FROM complaints WHERE id = $1 LIMIT 1`,
        [dto.complaint_id],
      );
      if (!c.rows[0]) throw new BadRequestException("Complaint not found");
    }

    const params: any[] = [id];
    const sets = ["updated_at = now()"];
    const add = (v: any) => {
      params.push(v);
      return `$${params.length}`;
    };
    for (const f of [
      "bank_name",
      "bank_account_no",
      "statement_description",
      "investigation_notes",
      "evidence_uri",
      "complaint_id",
    ] as const) {
      if (dto[f] !== undefined) sets.push(`${f} = ${add(dto[f])}`);
    }

    const { rows } = await this.pool.query(
      `UPDATE statement_refunds SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
      params,
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // MATCH — hubungkan refund ke transaksi asal. Tidak pernah mengkredit saldo.
  // ---------------------------------------------------------------------------
  async match(id: number, user: AuthedUser, dto: MatchStatementRefundDto) {
    const row = await this.fetchRefund(id);
    if (LOCKED_STATUSES.includes(row.status) || row.status === "PENDING_APPROVAL") {
      throw new BadRequestException(
        `Refund berstatus ${row.status} tidak dapat di-match ulang.`,
      );
    }

    const transfer = await this.fetchTransfer(dto.original_transfer_id);
    if (!transfer) throw new BadRequestException("Transfer not found");

    if (dto.complaint_id) {
      const c = await this.pool.query(
        `SELECT id FROM complaints WHERE id = $1 LIMIT 1`,
        [dto.complaint_id],
      );
      if (!c.rows[0]) throw new BadRequestException("Complaint not found");
    }

    // Nominal persis = keyakinan tinggi. Selisih nominal wajib disertai catatan
    // investigasi dan masuk antrean NEED_INVESTIGATION, bukan langsung MATCHED.
    const exact = Number(transfer.amount) === Number(row.amount);
    const notes = dto.investigation_notes ?? row.investigation_notes ?? null;
    if (!exact && !notes) {
      throw new BadRequestException(
        "Nominal refund berbeda dengan transaksi asal — investigation_notes wajib diisi.",
      );
    }

    const { rows } = await this.pool.query(
      `UPDATE statement_refunds
          SET original_transfer_id = $2,
              partner_application_id = $3,
              complaint_id = COALESCE($4, complaint_id),
              match_method = $5,
              match_confidence = $6,
              status = $7,
              investigation_notes = $8,
              matched_by = $9,
              matched_at = now(),
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        id,
        transfer.id,
        transfer.sender_application_id ?? null,
        dto.complaint_id ?? null,
        dto.match_method ?? "MANUAL",
        exact ? "HIGH" : "LOW",
        exact ? "MATCHED" : "NEED_INVESTIGATION",
        notes,
        resolveUserId(user),
      ],
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // SUBMIT — ajukan ke FinanceManager. Tetap tidak mengkredit saldo.
  // ---------------------------------------------------------------------------
  async submit(id: number, user: AuthedUser) {
    const row = await this.fetchRefund(id);
    if (!["MATCHED", "NEED_INVESTIGATION"].includes(row.status)) {
      throw new BadRequestException(
        `Hanya refund berstatus MATCHED/NEED_INVESTIGATION yang dapat diajukan (status saat ini: ${row.status}).`,
      );
    }
    if (!row.original_transfer_id) {
      throw new BadRequestException(
        "original_transfer_id wajib ada sebelum pengajuan approval.",
      );
    }

    const { rows } = await this.pool.query(
      `UPDATE statement_refunds
          SET status='PENDING_APPROVAL', submitted_by=$2, submitted_at=now(), updated_at=now()
        WHERE id=$1 RETURNING *`,
      [id, resolveUserId(user)],
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // DECISION — FinanceManager. Satu-satunya gerbang menuju kredit saldo.
  // ---------------------------------------------------------------------------
  async decision(id: number, user: AuthedUser, dto: StatementRefundDecisionDto) {
    const row = await this.fetchRefund(id);

    // Guard anti double-credit: sekali disetujui/dikredit, tidak bisa disetujui lagi.
    if (row.status === "BALANCE_CREDITED" || row.balance_event_id) {
      throw new BadRequestException(
        "Refund sudah dikreditkan ke saldo — tidak dapat diproses ulang.",
      );
    }
    if (row.status !== "PENDING_APPROVAL") {
      throw new BadRequestException(
        `Hanya refund berstatus PENDING_APPROVAL yang dapat diputuskan (status saat ini: ${row.status}).`,
      );
    }

    const actorId = resolveUserId(user);

    if (dto.decision === "REJECTED") {
      const reason = dto.reason?.trim() || null;
      if (!reason) throw new BadRequestException("reason wajib diisi untuk penolakan.");
      const { rows } = await this.pool.query(
        `UPDATE statement_refunds
            SET status='REJECTED', rejected_by=$2, rejected_at=now(),
                rejection_reason=$3, finance_notes=COALESCE($4, finance_notes), updated_at=now()
          WHERE id=$1 RETURNING *`,
        [id, actorId, reason, dto.finance_notes ?? null],
      );
      return { ...rows[0], balance_credit_status: this.balanceCreditStatus(rows[0]) };
    }

    // APPROVED. Kredit saldo partner TIDAK dilakukan di sini karena repo ini
    // belum punya modul balance — lihat balanceCreditStatus(). Saat modul itu
    // ada, bungkus UPDATE + insert balance event dalam satu transaksi lalu set
    // status BALANCE_CREDITED + credited_at + balance_event_id.
    const { rows } = await this.pool.query(
      `UPDATE statement_refunds
          SET status='APPROVED', approved_by=$2, approved_at=now(),
              finance_notes=COALESCE($3, finance_notes), updated_at=now()
        WHERE id=$1 AND status='PENDING_APPROVAL'
        RETURNING *`,
      [id, actorId, dto.finance_notes ?? null],
    );
    if (!rows[0]) {
      throw new BadRequestException("Refund sudah diproses oleh proses lain.");
    }
    return { ...rows[0], balance_credit_status: this.balanceCreditStatus(rows[0]) };
  }
}
