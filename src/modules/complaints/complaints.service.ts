import {
  Inject,
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Pool } from "pg";
import { resolveUserId } from "../../common/auth.util";
import {
  CreateComplaintDto,
  UpdateComplaintDto,
  ListComplaintsQueryDto,
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
         complaint_notes, status, created_by, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'OPEN',$12,now())
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
        dto.complaint_notes,
        actorId,
      ],
    );

    return result.rows[0];
  }

  // ---------------------------------------------------------------------------
  // LIST
  // ---------------------------------------------------------------------------
  async list(user: AuthedUser, query: ListComplaintsQueryDto) {
    const role = user.role;
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const offset = (page - 1) * limit;

    const params: any[] = [];
    const conditions: string[] = [];

    if (role === "FrontDesk") {
      params.push(resolveUserId(user));
      conditions.push(`c.created_by = $${params.length}`);
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
      `SELECT c.id, c.complaint_no, c.customer_application_id, c.customer_cif_no,
              c.customer_name, c.customer_type, c.transfer_id, c.transaction_reference,
              c.category, c.channel, c.priority, c.status,
              c.resolution_notes, c.created_by, c.resolved_at, c.created_at, c.updated_at
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
  async getById(id: number, user: AuthedUser) {
    const q = await this.pool.query(`SELECT * FROM complaints WHERE id = $1`, [id]);

    if (!q.rows[0]) throw new NotFoundException("Complaint not found");
    const row = q.rows[0];

    if (user.role === "FrontDesk") {
      if (String(row.created_by) !== String(resolveUserId(user))) {
        throw new ForbiddenException("Not allowed");
      }
    }

    return row;
  }

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------
  async update(id: number, user: AuthedUser, dto: UpdateComplaintDto) {
    const existing = await this.getById(id, user);

    if (user.role === "FrontDesk") {
      if (existing.status !== "OPEN") {
        throw new ForbiddenException("FrontDesk can only update OPEN complaints");
      }
      if (dto.status === "RESOLVED" || dto.status === "CLOSED") {
        throw new ForbiddenException("FrontDesk cannot set status RESOLVED or CLOSED");
      }
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
}
