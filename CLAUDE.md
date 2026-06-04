# KESH KYC/KYB Backend Context

This is the backend service for KYC/KYB PJP 3.

## Stack

- NestJS
- PostgreSQL via `pg`
- SQL migrations in `infra/db/migrations`
- E2E tests in `test/e2e`
- API global prefix: `/api`

## Current Stable Status

Backend migration and e2e tests are passing.

Command:

```bash
npm run db:migrate
npm run db:seed
npm run build
npm run test:e2e