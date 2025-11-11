import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg'
import * as bcrypt from 'bcryptjs';

export type UserRow = {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: 'BranchAdmin'|'ComplianceReviewer'|'ComplianceLead'|'Auditor';
  branch_id: number | null;
  last_login_at: Date | null;
  created_at: Date;
};

@Injectable()
export class UsersService {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  async findByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE email=$1 LIMIT 1', [email]);
    return rows[0] || null;
  }

  async findById(id: number): Promise<UserRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE id=$1 LIMIT 1', [id]);
    return rows[0] || null;
  }

  async verifyPassword(plain: string, hash: string) {
    return bcrypt.compare(plain, hash);
  }

  async touchLastLogin(userId: number) {
    await this.pool.query('UPDATE users SET last_login_at = now() WHERE id=$1', [userId]);
  }
}
