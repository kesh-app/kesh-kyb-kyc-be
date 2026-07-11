"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DbModule = void 0;
const common_1 = require("@nestjs/common");
const pg_1 = require("pg");
const logger = new common_1.Logger('DbModule');
function extractMessage(err) {
    // AggregateError (ES2021) contains an `errors` array — duck-type it since target is ES2020
    const aggregate = err;
    if (Array.isArray(aggregate?.errors)) {
        return aggregate.errors
            .map((e) => (e instanceof Error ? e.message : String(e)))
            .join(' | ');
    }
    return err instanceof Error ? err.message : String(err);
}
let DbModule = class DbModule {
};
exports.DbModule = DbModule;
exports.DbModule = DbModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [
            {
                provide: 'PG_POOL',
                useFactory: async () => {
                    // When DATABASE_URL is absent, pg reads PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
                    // from process.env automatically — no fallback logic needed here.
                    const pool = new pg_1.Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined);
                    pool.on('error', (err) => {
                        logger.error(`Idle client error: ${extractMessage(err)}`);
                    });
                    // Verify connectivity at startup so misconfiguration is caught immediately.
                    try {
                        const client = await pool.connect();
                        client.release();
                        logger.log('PostgreSQL connected successfully');
                    }
                    catch (err) {
                        logger.error(`PostgreSQL connection FAILED — ${extractMessage(err)}. ` +
                            `Check PGHOST=${process.env.PGHOST} PGPORT=${process.env.PGPORT} ` +
                            `PGUSER=${process.env.PGUSER} PGDATABASE=${process.env.PGDATABASE}`);
                        // Do not throw: allow the process to start so health-check endpoints
                        // remain reachable and logs are visible. Each failed query will log its own error.
                    }
                    return pool;
                },
            },
        ],
        exports: ['PG_POOL'],
    })
], DbModule);
//# sourceMappingURL=db.module.js.map