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
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WatchlistService = void 0;
const common_1 = require("@nestjs/common");
const pg_1 = require("pg");
const XLSX = __importStar(require("xlsx"));
const crypto_1 = require("crypto");
let WatchlistService = class WatchlistService {
    constructor(pool) {
        this.pool = pool;
    }
    /** Normalize string */
    norm(v) {
        if (!v)
            return null;
        return v
            .normalize("NFKD")
            .replace(/\p{Diacritic}/gu, "")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();
    }
    buildNaturalKey(r) {
        const key = [
            r.list_type || "",
            this.norm(r.list_source) || "",
            this.norm(r.full_name) || this.norm(r.entity_name) || "",
            r.date_of_birth || "",
        ].join("|");
        return (0, crypto_1.createHash)("sha1").update(key).digest("hex");
    }
    parseAliases(v) {
        if (!v)
            return null;
        const arr = v
            .split(/[;,|]/)
            .map((s) => s.trim())
            .filter(Boolean);
        return arr.length ? arr : null;
    }
    parseAssociated(v) {
        return this.parseAliases(v);
    }
    mapRow(raw, list_type, list_source) {
        const r = {
            list_type,
            list_source,
            unique_id: raw.Unique_ID || null,
            full_name: raw.Full_Name || null,
            alias_name: this.parseAliases(raw.Alias_Name || null),
            gender: raw.Gender || null,
            date_of_birth: raw.Date_of_Birth || null,
            place_of_birth: raw.Place_of_Birth || null,
            nationality: raw.Nationality || null,
            national_id_number: raw.National_ID_Number || null,
            tax_identification_number: raw.Tax_Identification_Number || null,
            position_title: raw.Position_Title || null,
            institution_name: raw.Institution_Name || null,
            pep_type: raw.PEP_Type || null,
            status: raw.Status || null,
            address: raw.Address || null,
            city: raw.City || null,
            country: raw.Country || null,
            entity_name: raw.Entity_Name || null,
            registration_number: raw.Registration_Number || null,
            legal_form: raw.Legal_Form || null,
            country_of_registration: raw.Country_of_Registration || null,
            associated_individuals: this.parseAssociated(raw.Associated_Individuals || null),
            associated_entities: this.parseAssociated(raw.Associated_Entities || null),
            relationship_type: raw.Relationship_Type || null,
            sanction_number: raw.Sanction_Number || null,
            inclusion_date: raw.Inclusion_Date || null,
            removal_date: raw.Removal_Date || null,
            list_updated_date: raw.List_Updated_Date || null,
            source_url: raw.Source_URL || null,
            remarks: raw.Remarks || null,
        };
        return r;
    }
    parseWorkbook(buf, list_type, list_source) {
        const wb = XLSX.read(buf, { type: "buffer", cellDates: true, raw: false });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
        return rows.map((r) => this.mapRow(r, list_type, list_source));
    }
    async upsertRow(r) {
        const name_norm = this.norm(r.full_name || r.entity_name || "");
        const aliases = r.alias_name || null;
        const aliases_concat = aliases ? aliases.join(" ") : null;
        const natural_key = this.buildNaturalKey(r);
        const uid = r.unique_id?.trim() || null;
        // Kolom values (34 params), dipakai bersama untuk INSERT dan UPDATE
        const vals = [
            r.list_type, // $1
            r.list_source, // $2
            uid, // $3
            natural_key, // $4
            r.full_name || r.entity_name || null, // $5
            name_norm, // $6
            aliases, // $7
            aliases_concat, // $8
            r.gender, // $9
            r.date_of_birth, // $10
            r.place_of_birth, // $11
            r.nationality, // $12
            r.national_id_number, // $13
            r.tax_identification_number, // $14
            r.position_title, // $15
            r.institution_name, // $16
            r.pep_type, // $17
            r.status, // $18
            r.address, // $19
            r.city, // $20
            r.country, // $21
            r.entity_name, // $22
            r.registration_number, // $23
            r.legal_form, // $24
            r.country_of_registration, // $25
            r.associated_individuals, // $26
            r.associated_entities, // $27
            r.relationship_type, // $28
            r.sanction_number, // $29
            r.inclusion_date, // $30
            r.removal_date, // $31
            r.list_updated_date, // $32
            r.source_url, // $33
            r.remarks, // $34
        ];
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            // Cari existing: coba via upper(unique_id) dulu, fallback ke natural_key
            let existingId = null;
            if (uid) {
                const { rows } = await client.query(`SELECT id FROM watchlist_entries WHERE upper(unique_id) = upper($1) LIMIT 1`, [uid]);
                if (rows[0])
                    existingId = rows[0].id;
            }
            if (!existingId) {
                const { rows } = await client.query(`SELECT id FROM watchlist_entries WHERE natural_key = $1 LIMIT 1`, [natural_key]);
                if (rows[0])
                    existingId = rows[0].id;
            }
            if (existingId) {
                await client.query(`UPDATE watchlist_entries SET
            list_type=$1, list_source=$2,
            unique_id=COALESCE($3, unique_id), natural_key=$4,
            name=$5, name_norm=$6, aliases=$7, aliases_concat=$8,
            gender=$9, date_of_birth=$10, place_of_birth=$11, nationality=$12,
            national_id_number=$13, tax_identification_number=$14,
            position_title=$15, institution_name=$16, pep_type=$17, status=$18,
            address=$19, city=$20, country=$21, entity_name=$22,
            registration_number=$23, legal_form=$24, country_of_registration=$25,
            associated_individuals=$26, associated_entities=$27,
            relationship_type=$28, sanction_number=$29, inclusion_date=$30,
            removal_date=$31, list_updated_date=$32, source_url=$33, remarks=$34,
            updated_at=now()
           WHERE id=$35`, [...vals, existingId]);
            }
            else {
                await client.query(`INSERT INTO watchlist_entries
            (list_type, list_source, unique_id, natural_key,
             name, name_norm, aliases, aliases_concat, gender, date_of_birth, place_of_birth, nationality,
             national_id_number, tax_identification_number, position_title, institution_name, pep_type, status,
             address, city, country, entity_name, registration_number, legal_form, country_of_registration,
             associated_individuals, associated_entities, relationship_type, sanction_number, inclusion_date,
             removal_date, list_updated_date, source_url, remarks, updated_at)
           VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34, now())`, vals);
            }
            await client.query("COMMIT");
        }
        catch (e) {
            await client.query("ROLLBACK");
            throw e;
        }
        finally {
            client.release();
        }
    }
    async ingestBuffer(buf, list_type, list_source, userId, originalFilename) {
        const rows = this.parseWorkbook(buf, list_type, list_source);
        if (!rows.length)
            throw new common_1.BadRequestException("File kosong / sheet pertama tanpa data yang valid");
        let successRows = 0;
        let errorMessage = null;
        for (const r of rows) {
            try {
                await this.upsertRow(r);
                successRows++;
            }
            catch (err) {
                if (!errorMessage)
                    errorMessage = "";
                errorMessage += `${err.message}; `;
            }
        }
        // insert ke log
        const logRes = await this.pool.query(`INSERT INTO watchlist_ingest_logs(actor_id, list_type, list_source, original_filename, total_rows, success_rows, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING actor_id AS uploaded_by`, [
            userId,
            list_type,
            list_source,
            originalFilename,
            rows.length,
            successRows,
            errorMessage,
        ]);
        return {
            ok: true,
            total: rows.length,
            success: successRows,
            errors: errorMessage,
            log: { uploaded_by: logRes.rows[0]?.uploaded_by ?? null },
        };
    }
    async listIngestHistory(limit = 20) {
        const q = await this.pool.query(`SELECT l.id, l.created_at, l.list_type, l.list_source, l.original_filename,
       l.total_rows, l.success_rows, l.error_message,
       u.name AS uploaded_by      -- <-- ganti full_name menjadi name
FROM watchlist_ingest_logs l
LEFT JOIN users u ON u.id = l.actor_id
ORDER BY l.created_at DESC
LIMIT $1
`, [limit]);
        return q.rows;
    }
};
exports.WatchlistService = WatchlistService;
exports.WatchlistService = WatchlistService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)("PG_POOL")),
    __metadata("design:paramtypes", [pg_1.Pool])
], WatchlistService);
//# sourceMappingURL=watchlist.service.js.map