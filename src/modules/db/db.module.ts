import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';

@Global()
@Module({
  providers: [
    {
      provide: 'PG_POOL',
      useFactory: async () => {
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        return pool;
      },
    },
  ],
  exports: ['PG_POOL'],
})
export class DbModule {}
