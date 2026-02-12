import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('kyc')
export class DashboardController {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  @Get('dashboard-summary')
  async summary(@Query('limit') limit = '5') {
    const lim = Math.max(1, Math.min(50, Number(limit) || 5));

    // total per status dari applications
    const { rows: statusRows } = await this.pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM applications
      GROUP BY status
    `);

    // bucket risk dari risk_profiles (LOW/MEDIUM/HIGH/PROHIBITED)
    const { rows: riskRows } = await this.pool.query(`
      SELECT rp.risk_level AS level, COUNT(*)::int AS count
      FROM risk_profiles rp
      GROUP BY rp.risk_level
    `);

    // recent submissions + field tampilan (JOIN ke persons & business_entities)
    const { rows: recent } = await this.pool.query(
      `
      SELECT
        a.id,
        a.type,
        a.status,
        a.created_at,
        a.submitted_at,
        rp.risk_level,
        rp.score_total AS risk_score,
        CASE WHEN a.type = 'INDIVIDUAL'
             THEN NULLIF(p.full_name,'')
             ELSE NULLIF(b.legal_name,'')
        END AS full_name,
        CASE WHEN a.type = 'INDIVIDUAL'
             THEN NULLIF(p.email,'')
             ELSE NULL
        END AS email,
        CASE WHEN a.type = 'INDIVIDUAL'
             THEN 'KTP/PASPOR'    -- (placeholder, bisa diubah jika kamu simpan tipe identitas)
             ELSE 'NPWP/NIB'
        END AS id_type
      FROM applications a
      LEFT JOIN risk_profiles      rp ON rp.application_id = a.id
      LEFT JOIN persons            p  ON p.id            = a.person_id
      LEFT JOIN business_entities  b  ON b.id            = a.business_id
      ORDER BY a.created_at DESC
      LIMIT $1
      `,
      [lim],
    );

    const { rows: totalRows } = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM applications`
    );

    const totals = {
      total: totalRows[0]?.total ?? 0,
      status: Object.fromEntries(statusRows.map(r => [r.status, r.count])),
      risk: Object.fromEntries(riskRows.map(r => [r.level ?? 'UNKNOWN', r.count])),
    };

    return { totals, recent };
  }

  // Opsional: kalau FE masih memanggil /kyc/submissions?limit=5
  @Get('submissions')
  async submissions(@Query('limit') limit = '5') {
    const lim = Math.max(1, Math.min(50, Number(limit) || 5));

    const { rows } = await this.pool.query(
      `
      SELECT
        a.id,
        a.type,
        a.status,
        a.created_at,
        a.submitted_at,
        rp.risk_level,
        rp.score_total AS risk_score,
        CASE WHEN a.type = 'INDIVIDUAL'
             THEN NULLIF(p.full_name,'')
             ELSE NULLIF(b.legal_name,'')
        END AS full_name,
        CASE WHEN a.type = 'INDIVIDUAL'
             THEN NULLIF(p.email,'')
             ELSE NULL
        END AS email,
        CASE WHEN a.type = 'INDIVIDUAL'
             THEN 'KTP/PASPOR'
             ELSE 'NPWP/NIB'
        END AS id_type
      FROM applications a
      LEFT JOIN risk_profiles      rp ON rp.application_id = a.id
      LEFT JOIN persons            p  ON p.id            = a.person_id
      LEFT JOIN business_entities  b  ON b.id            = a.business_id
      ORDER BY a.created_at DESC
      LIMIT $1
      `,
      [lim],
    );

    return rows;
  }
}
