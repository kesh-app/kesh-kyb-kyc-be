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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadsService = void 0;
const common_1 = require("@nestjs/common");
const fs = __importStar(require("fs/promises"));
const fssync = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
let UploadsService = class UploadsService {
    constructor() {
        this.baseUrl = process.env.BASE_URL || 'http://localhost:4000';
        this.uploadDir = process.env.UPLOAD_DIR || 'uploads';
    }
    // Simpan file ke folder lokal dan kembalikan URL + object_key
    async uploadBuffer(buf, mime, ext = '') {
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
        // object_key relatif yang konsisten di semua driver (awali dengan "uploads/")
        const key = ['uploads', year, month, filename].join('/');
        // URL publik untuk disimpan di DB (dev/local served lewat /uploads)
        const url = `${this.baseUrl}/${key}`;
        return { key, url, meta: { mime } };
    }
    // Hapus file fisik berdasarkan object_key
    async deleteObject(key) {
        // key format: "uploads/YYYY/MM/uuid.ext"
        const localBase = this.uploadDir.replace(/\\/g, '/').replace(/^\.?\//, '');
        const rel = key.replace(/^uploads\//, `${localBase}/`);
        const filePath = path.resolve(process.cwd(), rel);
        try {
            await fs.unlink(filePath);
        }
        catch {
            // abaikan jika file tidak ada
        }
    }
};
exports.UploadsService = UploadsService;
exports.UploadsService = UploadsService = __decorate([
    (0, common_1.Injectable)()
], UploadsService);
//# sourceMappingURL=uploads.service.js.map