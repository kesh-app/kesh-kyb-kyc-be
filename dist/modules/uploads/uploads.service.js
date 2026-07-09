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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
var UploadsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadsService = void 0;
const common_1 = require("@nestjs/common");
const fs = __importStar(require("fs/promises"));
const fssync = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const obs_storage_1 = require("./obs.storage");
const OBS_REQUIRED_VARS = [
    'OBS_BUCKET_NAME',
    'OBS_REGION',
    'OBS_ENDPOINT',
    'HUAWEI_OBS_ACCESS_KEY_ID',
    'HUAWEI_OBS_SECRET_ACCESS_KEY',
];
let UploadsService = UploadsService_1 = class UploadsService {
    constructor() {
        this.logger = new common_1.Logger(UploadsService_1.name);
        this.baseUrl = process.env.BASE_URL || 'http://localhost:4000';
        this.uploadDir = process.env.UPLOAD_DIR || 'uploads';
        this.provider = (process.env.STORAGE_PROVIDER || 'LOCAL').toUpperCase();
        this.obs = null;
    }
    onModuleInit() {
        if (this.provider === 'HUAWEI_OBS') {
            const missing = OBS_REQUIRED_VARS.filter((k) => !process.env[k]);
            if (missing.length) {
                this.logger.error(`STORAGE_PROVIDER=HUAWEI_OBS but missing env vars: ${missing.join(', ')}. ` +
                    `Falling back to LOCAL — files will NOT be stored in OBS.`);
                this.provider = 'LOCAL';
            }
            else {
                this.obs = new obs_storage_1.ObsStorage();
                this.logger.log(`Storage: Huawei OBS — bucket=${process.env.OBS_BUCKET_NAME} endpoint=${process.env.OBS_ENDPOINT}`);
            }
        }
        else {
            this.logger.log(`Storage: LOCAL — dir=${path.resolve(this.uploadDir)}`);
        }
    }
    isObs() {
        return this.provider === 'HUAWEI_OBS' && this.obs !== null;
    }
    async uploadBuffer(buf, mime, ext = '', objectKey) {
        if (this.isObs()) {
            return this.obs.uploadBuffer(buf, mime, ext, objectKey);
        }
        return this.uploadLocal(buf, mime, ext);
    }
    async deleteObject(key) {
        if (this.isObs()) {
            return this.obs.deleteObject(key);
        }
        return this.deleteLocal(key);
    }
    /**
     * Returns a URL to access the stored file.
     * OBS: generates a short-lived signed URL (private bucket).
     * LOCAL: returns the public static URL.
     */
    async getSignedUrl(key, expiresSeconds = 300) {
        if (this.isObs()) {
            return this.obs.getSignedUrl(key, expiresSeconds);
        }
        if (key.startsWith('http://') || key.startsWith('https://'))
            return key;
        return `${this.baseUrl}/${key}`;
    }
    async uploadLocal(buf, mime, ext = '') {
        const now = new Date();
        const year = String(now.getUTCFullYear());
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const dir = path.join(this.uploadDir, year, month);
        if (!fssync.existsSync(dir)) {
            await fs.mkdir(dir, { recursive: true });
        }
        const filename = `${(0, crypto_1.randomUUID)()}${ext ? '.' + ext : ''}`;
        const filePath = path.join(dir, filename);
        await fs.writeFile(filePath, buf);
        const key = ['uploads', year, month, filename].join('/');
        const url = `${this.baseUrl}/${key}`;
        return { key, url, meta: { mime } };
    }
    async deleteLocal(key) {
        const localBase = this.uploadDir.replace(/\\/g, '/').replace(/^\.?\//, '');
        const rel = key.replace(/^uploads\//, `${localBase}/`);
        const filePath = path.resolve(process.cwd(), rel);
        try {
            await fs.unlink(filePath);
        }
        catch {
            // ignore if file doesn't exist
        }
    }
};
exports.UploadsService = UploadsService;
exports.UploadsService = UploadsService = UploadsService_1 = __decorate([
    (0, common_1.Injectable)()
], UploadsService);
//# sourceMappingURL=uploads.service.js.map