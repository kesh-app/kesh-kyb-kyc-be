import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Inject,
} from "@nestjs/common";
import { Pool } from "pg";
import * as bcrypt from "bcryptjs";
import { CreateAdminUserDto, UpdateAdminUserDto } from "./admin.dto";

export type UserRow = {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role:
    | "BranchAdmin"
    | "FrontDesk"
    | "ComplianceLead"
    | "Auditor"
    | "FinanceStaff"
    | "FinanceManager"
    | "SystemAdmin"
    | "Director"; // ✅ tambah
  branch_id: number | null;
  last_login_at: Date | null;
  created_at: Date;
};

@Injectable()
export class UsersService {
  constructor(@Inject("PG_POOL") private readonly pool: Pool) {}

  async findByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM users WHERE email=$1 LIMIT 1",
      [email],
    );
    return rows[0] || null;
  }

  async findById(id: number): Promise<UserRow | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM users WHERE id=$1 LIMIT 1",
      [id],
    );
    return rows[0] || null;
  }

  async verifyPassword(plain: string, hash: string) {
    return bcrypt.compare(plain, hash);
  }

  async touchLastLogin(userId: number) {
    await this.pool.query(
      "UPDATE users SET last_login_at = now() WHERE id=$1",
      [userId],
    );
  }

  async listAdmins() {
    const res = await this.pool.query(
      `SELECT
       id,
       email,
       name AS full_name,      -- ✅ pakai kolom name, alias jadi full_name
       role,
       branch_id,
       is_active,
       created_at
     FROM users
     ORDER BY id DESC`,
    );
    return res.rows;
  }

  async createAdmin(dto: CreateAdminUserDto, actorId: number) {
    // cek email unik
    const existing = await this.pool.query(
      "SELECT id FROM users WHERE email = $1",
      [dto.email],
    );
    const emailCount = existing.rowCount ?? 0;
    if (emailCount > 0) {
      throw new BadRequestException("Email already exists");
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const res = await this.pool.query(
      `INSERT INTO users (
      name,
      email,
      password_hash,
      role,
      branch_id,
      is_active,
      created_at
   )
   VALUES ($1,$2,$3,$4,$5,TRUE,now())
   RETURNING
     id,
     email,
     name AS full_name,
     role,
     branch_id,
     is_active,
     created_at`,
      [dto.fullName, dto.email, passwordHash, dto.role, dto.branchId ?? null],
    );

    const user = res.rows[0];

    await this.pool.query(
      `INSERT INTO audit_logs(actor_id, action, object_type, object_id, before_json, after_json)
       VALUES ($1,'USER_CREATE','USER',$2,NULL,$3)`,
      [actorId, String(user.id), user],
    );

    return user;
  }

  async updateAdmin(id: number, dto: UpdateAdminUserDto, actorId: number) {
    const existing = await this.pool.query(
      `SELECT
      id,
      email,
      name AS full_name,    -- ✅ alias
      role,
      branch_id,
      is_active
   FROM users
   WHERE id = $1`,
      [id],
    );

    const rowCount = existing.rowCount ?? 0;
    if (rowCount === 0) {
      throw new NotFoundException("User not found");
    }
    const before = existing.rows[0];

    const nextRole = dto.role ?? before.role;
    const nextActive =
      dto.isActive !== undefined ? dto.isActive : before.is_active;
    const nextBranch =
      dto.branchId !== undefined ? dto.branchId : before.branch_id;

    const res = await this.pool.query(
      `UPDATE users
   SET role = $2,
       is_active = $3,
       branch_id = $4
   WHERE id = $1
   RETURNING
     id,
     email,
     name AS full_name,
     role,
     branch_id,
     is_active,
     created_at`,
      [id, nextRole, nextActive, nextBranch],
    );

    const after = res.rows[0];

    await this.pool.query(
      `INSERT INTO audit_logs(actor_id, action, object_type, object_id, before_json, after_json)
       VALUES ($1,'USER_UPDATE_ADMIN','USER',$2,$3,$4)`,
      [actorId, String(id), before, after],
    );

    return after;
  }
  
  async getUserByApplicationId(applicationId: number) {
  const sql = `
    SELECT
      p.id AS person_id,
      p.full_name,
      p.identity_type,
      p.identity_number,
      p.dob,
      p.pob,
      p.nationality,
      p.phone,
      p.email,
      p.occupation,
      p.gender,
      p.address_identity,
      p.address_residential,
      a.id AS application_id,
      a.type AS application_type,
      a.status AS application_status,
      a.created_at AS application_created_at,
      a.approved_at AS application_approved_at,
      a.branch_id
    FROM persons p
    LEFT JOIN applications a ON a.person_id = p.id
    WHERE a.id = $1
    LIMIT 1
  `;
  const { rows } = await this.pool.query(sql, [applicationId]);
  if (!rows.length) return null;

  return rows[0];
}

  /** List semua user individu (opsional pagination) */
  async listIndividuals(limit = 50, offset = 0) {
    const sql = `
      SELECT 
        p.id AS person_id,
        p.full_name,
        p.phone,
        p.email,
        p.pep_self_declared,
        a.status AS application_status,
        a.created_at AS registration_date
      FROM persons p
      LEFT JOIN applications a
        ON a.person_id = p.id
      WHERE a.type = 'INDIVIDUAL'
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const { rows } = await this.pool.query(sql, [limit, offset]);
    return rows;
  }
}
