import { Global, Logger, Module } from '@nestjs/common';
import { Pool } from 'pg';

const logger = new Logger('DbModule');

function extractMessage(err: unknown): string {
  // AggregateError (ES2021) contains an `errors` array — duck-type it since target is ES2020
  const aggregate = err as { errors?: unknown[] };
  if (Array.isArray(aggregate?.errors)) {
    return aggregate.errors
      .map((e) => (e instanceof Error ? e.message : String(e)))
      .join(' | ');
  }
  return err instanceof Error ? err.message : String(err);
}

@Global()
@Module({
  providers: [
    {
      provide: 'PG_POOL',
      useFactory: async () => {
        // When DATABASE_URL is absent, pg reads PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
        // from process.env automatically — no fallback logic needed here.
        const pool = new Pool(
          process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined,
        );

        pool.on('error', (err) => {
          logger.error(`Idle client error: ${extractMessage(err)}`);
        });

        // Verify connectivity at startup so misconfiguration is caught immediately.
        try {
          const client = await pool.connect();
          client.release();
          logger.log('PostgreSQL connected successfully');
        } catch (err) {
          logger.error(
            `PostgreSQL connection FAILED — ${extractMessage(err)}. ` +
              `Check PGHOST=${process.env.PGHOST} PGPORT=${process.env.PGPORT} ` +
              `PGUSER=${process.env.PGUSER} PGDATABASE=${process.env.PGDATABASE}`,
          );
          // Do not throw: allow the process to start so health-check endpoints
          // remain reachable and logs are visible. Each failed query will log its own error.
        }

        return pool;
      },
    },
  ],
  exports: ['PG_POOL'],
})
export class DbModule {}
