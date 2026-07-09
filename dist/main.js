"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const common_1 = require("@nestjs/common");
const express = __importStar(require("express"));
const path = __importStar(require("path"));
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    // Build allowed origins list from env (comma-separated)
    const allowList = (process.env.CORS_ORIGIN || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    app.enableCors({
        origin: (origin, cb) => {
            // allow server-to-server / Postman (no Origin)
            if (!origin)
                return cb(null, true);
            let ok = false;
            try {
                const u = new URL(origin);
                const isDevTunnels = /\.devtunnels\.ms$/.test(u.hostname);
                ok = isDevTunnels || allowList.includes(origin);
            }
            catch {
                ok = false;
            }
            return ok ? cb(null, true) : cb(new Error('Not allowed by CORS'));
        },
        methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        exposedHeaders: ['Content-Disposition'],
        credentials: false, // pakai Bearer token, bukan cookie
    });
    app.useGlobalPipes(new common_1.ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    // serve file upload
    const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
    app.use('/uploads', express.static(uploadDir));
    // Warn early if OBS is configured but env vars are missing
    if ((process.env.STORAGE_PROVIDER || '').toUpperCase() === 'HUAWEI_OBS') {
        const obsRequired = [
            'OBS_BUCKET_NAME', 'OBS_REGION', 'OBS_ENDPOINT',
            'HUAWEI_OBS_ACCESS_KEY_ID', 'HUAWEI_OBS_SECRET_ACCESS_KEY',
        ];
        const missing = obsRequired.filter((k) => !process.env[k]);
        if (missing.length) {
            console.error(`[STORAGE] STORAGE_PROVIDER=HUAWEI_OBS but missing: ${missing.join(', ')} — will fall back to LOCAL`);
        }
    }
    const port = Number(process.env.API_PORT) || 4000;
    await app.listen(port);
    console.log(`API running at http://localhost:${port}/api`);
}
bootstrap();
//# sourceMappingURL=main.js.map