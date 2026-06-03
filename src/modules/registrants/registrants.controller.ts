import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('kyc')
export class RegistrantsController {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  @Get('registrants')
  async list(
    @Query('type') type = 'INDIVIDUAL', // INDIVIDUAL | BUSINESS
    @Query('q') q = '',
    @Query('status') status?: string,   // DRAFT|SUBMITTED|IN_REVIEW|ESCALATED|APPROVED|REJECTED
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    const lim = Math.max(1, Math.min(100, Number(limit) || 50));
    const off = Math.max(0, Number(offset) || 0);
    const isInd = String(type).toUpperCase() !== 'BUSINESS';

    // WHERE
    const wh: string[] = [];
    const params: any[] = [];

    wh.push(`a.type = $${params.push(isInd ? 'INDIVIDUAL' : 'BUSINESS')}`);

    if (status) {
      wh.push(`a.status = $${params.push(status.toUpperCase())}`);
    }
    if (q) {
      // cari di nama, email/phone (individu), nib/npwp (bisnis)
      if (isInd) {
        wh.push(
          `(
            p.full_name ILIKE $${params.push(`%${q}%`)} OR
            COALESCE(p.email,'') ILIKE $${params.push(`%${q}%`)} OR
            COALESCE(p.phone,'') ILIKE $${params.push(`%${q}%`)} OR
            COALESCE(p.name_norm,'') ILIKE $${params.push(`%${q}%`)}
          )`
        );
      } else {
        wh.push(
          `(
            b.legal_name ILIKE $${params.push(`%${q}%`)} OR
            COALESCE(b.trade_name,'') ILIKE $${params.push(`%${q}%`)} OR
            COALESCE(b.nib,'') ILIKE $${params.push(`%${q}%`)} OR
            COALESCE(b.npwp,'') ILIKE $${params.push(`%${q}%`)} OR
            COALESCE(b.name_norm,'') ILIKE $${params.push(`%${q}%`)}
          )`
        );
      }
    }

    const whereSql = wh.length ? `WHERE ${wh.join(' AND ')}` : '';

    const sql = `
      SELECT
        a.id AS application_id,
        a.type,
        a.status,
        a.created_at,
        COALESCE(ar.override_level, ar.risk_level) AS risk_level,
        ar.risk_score,
        ${isInd
          ? `p.full_name          AS display_name,
             p.email              AS email,
             p.phone              AS phone,
             NULL::text           AS nib,
             NULL::text           AS npwp`
          : `b.legal_name         AS display_name,
             NULL::text           AS email,
             NULL::text           AS phone,
             b.nib                AS nib,
             b.npwp               AS npwp`
        },
        COUNT(*) OVER()::int AS total_rows
      FROM applications a
      LEFT JOIN application_risk ar ON ar.application_id = a.id
      ${isInd ? 'LEFT JOIN persons p ON p.id = a.person_id'
              : 'LEFT JOIN business_entities b ON b.id = a.business_id'}
      ${whereSql}
      ORDER BY a.created_at DESC
      LIMIT $${params.push(lim)}
      OFFSET $${params.push(off)}
    `;

    const { rows } = await this.pool.query(sql, params);
    const total = rows[0]?.total_rows ?? 0;

    return {
      total,
      limit: lim,
      offset: off,
      items: rows.map(r => ({
        application_id: r.application_id,
        type: r.type,
        status: r.status,
        created_at: r.created_at,
        risk_level: r.risk_level,
        risk_score: r.risk_score,
        display_name: r.display_name,
        email: r.email,
        phone: r.phone,
        nib: r.nib,
        npwp: r.npwp,
      })),
    };
  }
}
