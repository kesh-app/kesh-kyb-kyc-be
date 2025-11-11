import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';

@Controller('health')
export class HealthController {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  @Get()
  async health() {
    const res = await this.pool.query('SELECT 1 as ok');
    return { ok: true, db: res.rows[0].ok === 1 };
  }
}
