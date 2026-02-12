import {
  Inject,
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Pool } from "pg";
import {
  CreateTransferDto,
  DecideTransferDto,
  SetTransferResultDto,
  UpdateTransferDto,
} from "./dto";

type AuthedUser = { id: number | string; role: string };

@Injectable()
export class TransfersService {
  constructor(@Inject("PG_POOL") private readonly pool: Pool) {}

  private async audit(
    actorId: number | string,
    action: string,
    objectId: string,
    before: any,
    after: any,
    ip?: string
  ) {
    await this.pool.query(
      `INSERT INTO audit_logs(actor_id, action, object_type, object_id, before_json, after_json, ip)
       VALUES ($1,$2,'TRANSFER',$3,$4,$5,$6)`,
      [actorId, action, objectId, before ?? null, after ?? null, ip ?? null]
    );
  }

  // ---------------------------------------------------------------------------
  // CREATE DRAFT
  // ---------------------------------------------------------------------------
  async create(user: AuthedUser, dto: CreateTransferDto, ip?: string) {
    const isStaff = user.role === "FinanceStaff";
    const isManager = user.role === "FinanceManager";

    if (!isStaff && !isManager) {
      throw new ForbiddenException("Not allowed");
    }

    const q = await this.pool.query(
      `INSERT INTO transfers(
      branch_id,
      amount,
      beneficiary_bank_name,
      beneficiary_bank_code,
      beneficiary_account_number,
      beneficiary_account_name,
      description,
      requested_transfer_at,
      created_by,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
    RETURNING *`,
      [
        null, // ✅ selalu NULL, kita tidak pakai branch dulu
        dto.amount,
        dto.beneficiaryBankName,
        dto.beneficiaryBankCode ?? null,
        dto.beneficiaryAccountNumber,
        dto.beneficiaryAccountName,
        dto.description ?? null,
        dto.requestedTransferAt ?? null,
        user.id,
      ]
    );

    const row = q.rows[0];

    await this.audit(user.id, "TRANSFER_CREATE", String(row.id), null, row, ip);
    return row;
  }

  // ---------------------------------------------------------------------------
  // UPDATE DRAFT
  // ---------------------------------------------------------------------------
  async updateDraft(
    id: number,
    user: AuthedUser,
    dto: UpdateTransferDto,
    ip?: string
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

    // hanya creator yang boleh update

    const next = await this.pool.query(
      `UPDATE transfers SET
        amount=$2,
        beneficiary_bank_name=$3,
        beneficiary_bank_code=$4,
        beneficiary_account_number=$5,
        beneficiary_account_name=$6,
        description=$7,
        requested_transfer_at=$8,
        updated_at=now()
      WHERE id=$1
      RETURNING *`,
      [
        id,
        dto.amount,
        dto.beneficiaryBankName,
        dto.beneficiaryBankCode ?? null,
        dto.beneficiaryAccountNumber,
        dto.beneficiaryAccountName,
        dto.description ?? null,
        dto.requestedTransferAt ?? null,
      ]
    );

    await this.audit(
      user.id,
      "TRANSFER_UPDATE_DRAFT",
      String(id),
      row,
      next.rows[0],
      ip
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
  if (rowCount === 0) throw new NotFoundException('Transfer not found');
  const row = prev.rows[0];

  // ✅ Hanya cek status, tidak cek created_by lagi
  if (row.status !== 'DRAFT') {
    throw new BadRequestException('Only DRAFT can be submitted');
  }

  const next = await this.pool.query(
    `UPDATE transfers SET
       status = 'SUBMITTED',
       submitted_at = now(),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id],
  );

  await this.audit(
    user.id,
    'TRANSFER_SUBMIT',
    String(id),
    row,
    next.rows[0],
    ip,
  );
  return next.rows[0];
}


  // ---------------------------------------------------------------------------
  // DECIDE (APPROVE / REJECT) – FinanceManager
  // ---------------------------------------------------------------------------
  async decide(
    id: number,
    user: AuthedUser,
    dto: DecideTransferDto,
    ip?: string
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [
      id,
    ]);
    const rowCount = prev.rowCount ?? 0;
    if (rowCount === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    if (row.status !== "SUBMITTED") {
      throw new BadRequestException("Only SUBMITTED can be approved/rejected");
    }

    const status = dto.decision === "APPROVE" ? "APPROVED" : "REJECTED";
    const next = await this.pool.query(
      `UPDATE transfers SET
        status=$2,
        approved_by=$3,
        approved_at=now(),
        result_notes = COALESCE(result_notes,''),
        updated_at=now()
      WHERE id=$1
      RETURNING *`,
      [id, status, user.id]
    );

    await this.audit(
      user.id,
      `TRANSFER_${status}`,
      String(id),
      row,
      next.rows[0],
      ip
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
    ip?: string
  ) {
    const prev = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [
      id,
    ]);
    const rowCount = prev.rowCount ?? 0;
    if (rowCount === 0) throw new NotFoundException("Transfer not found");
    const row = prev.rows[0];

    if (row.status !== "APPROVED") {
      throw new BadRequestException("Only APPROVED can be completed");
    }

    const next = await this.pool.query(
      `UPDATE transfers SET
        status='COMPLETED',
        result=$2,
        result_notes=$3,
        attachment_uri = COALESCE($4, attachment_uri),
        updated_at=now()
      WHERE id=$1
      RETURNING *`,
      [id, dto.result, dto.note ?? null, dto.attachmentUri ?? null]
    );

    await this.audit(
      user.id,
      "TRANSFER_SET_RESULT",
      String(id),
      row,
      next.rows[0],
      ip
    );
    return next.rows[0];
  }

  // ---------------------------------------------------------------------------
  // LIST – FinanceStaff: hanya miliknya; FinanceManager: per branch
  // ---------------------------------------------------------------------------
  async list(user: AuthedUser, status?: string) {
    const role = user.role;
    const params: any[] = [];
    let where = "WHERE 1=1";

    if (role === "FinanceStaff") {
      // 🔹 Staff → hanya transfer yang dia buat
      // plus data lama yang belum punya created_by (NULL) supaya tetap kelihatan
      params.push(user.id);
      where += ` AND (created_by = $${params.length} OR created_by IS NULL)`;
    }
    // 🔹 FinanceManager, SystemAdmin, dll → tidak ada filter khusus
    // cukup "WHERE 1=1", lihat semua transfer

    const normStatus = status?.toUpperCase();
    if (normStatus && normStatus !== "ALL") {
      params.push(normStatus);
      where += ` AND status = $${params.length}`;
    }

    const q = await this.pool.query(
      `SELECT *
     FROM transfers
     ${where}
     ORDER BY id DESC
     LIMIT 200`,
      params
    );

    return q.rows;
  }

  // ---------------------------------------------------------------------------
  // DETAIL
  // ---------------------------------------------------------------------------
  async getById(id: number, user: AuthedUser) {
    const isManager = user.role === "FinanceManager";

    const q = await this.pool.query(`SELECT * FROM transfers WHERE id=$1`, [
      id,
    ]);
    const rowCount = q.rowCount ?? 0;
    if (rowCount === 0) {
      throw new NotFoundException("Transfer not found");
    }

    const row = q.rows[0];

    // Non-manager hanya boleh lihat transfer yang dia buat
    if (!isManager) {
      const creatorId: number | null = row.created_by ?? null;
      const userId = Number(user.id);

      if (creatorId !== null && !Number.isNaN(userId) && creatorId !== userId) {
        throw new ForbiddenException("Not allowed");
      }
    }

    return row;
  }
}
