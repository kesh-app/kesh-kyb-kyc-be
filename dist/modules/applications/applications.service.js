"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApplicationsService = void 0;
const common_1 = require("@nestjs/common");
const pg_1 = require("pg");
// ─── Internal Preliminary Risk Scoring — RBA v2 ────────────────────────────
// Bukan formula resmi BI. Dipakai sebagai dasar review compliance internal.
const SIMILARITY_THRESHOLD = 0.35;
// Bobot per faktor (satuan poin, cap total 100)
const W = {
    DTTOT_CONFIRMED: 100,
    PPPSPM_CONFIRMED: 100,
    PEP_CONFIRMED: 40,
    PEP_CANDIDATE: 20,
    DTTOT_CANDIDATE: 50,
    PPPSPM_CANDIDATE: 50,
    DOC_MISSING: 10,
    DOC_REJECTED: 15,
    HIGH_RISK_OCCUPATION: 15,
    PEP_SELF_DECLARED: 40,
    HIGH_RISK_ACTIVITY: 20,
    HIGH_RISK_LEGAL_FORM: 10,
    BO_MISSING: 30,
    GEOGRAPHY: 15,
    RBA_OCC_HIGH: 20,
    RBA_OCC_MEDIUM: 10,
    RBA_GEO_HIGH: 15,
    RBA_GEO_MEDIUM: 7,
};
// Kata kunci pekerjaan berisiko tinggi (individual)
const HIGH_RISK_OCCUPATIONS = [
    'money changer', 'remittance', 'crypto', 'casino', 'gambling',
    'precious metal', 'arms', 'nonprofit', 'charity', 'politician', 'public official',
    'pejabat', 'politisi', 'kasino', 'judi', 'logam mulia', 'senjata', 'tukar valas',
];
// Kata kunci kegiatan usaha berisiko tinggi (bisnis)
const HIGH_RISK_ACTIVITIES = [
    'money changer', 'remittance', 'crypto', 'virtual asset', 'casino', 'gambling',
    'precious metal', 'arms', 'weapon', 'nonprofit', 'charity', 'foundation',
    'yayasan', 'donation', 'cash intensive', 'judi', 'kasino', 'logam mulia',
    'senjata', 'donasi', 'amal', 'tukar valas',
];
// Bentuk hukum berisiko tinggi
const HIGH_RISK_LEGAL_FORMS = ['YAYASAN', 'FOUNDATION', 'NONPROFIT', 'KOPERASI'];
// Placeholder daftar negara berisiko tinggi — dipelihara oleh compliance (FATF/BI)
const HIGH_RISK_COUNTRIES = [];
// ── RBA Occupation mapping — profil pekerjaan (RBA internal)
const RBA_OCCUPATION_MAP = [
    // HIGH (+20)
    { name: 'pejabat lembaga legislatif dan pemerintah', risk: 'HIGH' },
    { name: 'legislative and government officials', risk: 'HIGH' },
    { name: 'government officials', risk: 'HIGH' },
    { name: 'pegawai negeri sipil', risk: 'HIGH' },
    { name: 'pejabat pemerintah', risk: 'HIGH' },
    { name: 'civil servant', risk: 'HIGH' },
    { name: 'private employees', risk: 'HIGH' },
    { name: 'private employee', risk: 'HIGH' },
    { name: 'self-employed', risk: 'HIGH' },
    { name: 'self employed', risk: 'HIGH' },
    { name: 'pegawai swasta', risk: 'HIGH' },
    { name: 'wiraswasta', risk: 'HIGH' },
    { name: 'pns', risk: 'HIGH' },
    // MEDIUM (+10)
    { name: 'political party administrators', risk: 'MEDIUM' },
    { name: 'political party administrator', risk: 'MEDIUM' },
    { name: 'pegawai bumn/bumd', risk: 'MEDIUM' },
    { name: 'pengurus parpol', risk: 'MEDIUM' },
    { name: 'pegawai bumn', risk: 'MEDIUM' },
    { name: 'pegawai bumd', risk: 'MEDIUM' },
    { name: 'bumn', risk: 'MEDIUM' },
    { name: 'bumd', risk: 'MEDIUM' },
    // LOW (+0, info)
    { name: 'profesional dan konsultan', risk: 'LOW' },
    { name: 'bank employees', risk: 'LOW' },
    { name: 'bank employee', risk: 'LOW' },
    { name: 'pegawai bank', risk: 'LOW' },
    { name: 'profesional', risk: 'LOW' },
    { name: 'professional', risk: 'LOW' },
    { name: 'konsultan', risk: 'LOW' },
    { name: 'consultant', risk: 'LOW' },
    { name: 'polri', risk: 'LOW' },
    { name: 'police', risk: 'LOW' },
    { name: 'army', risk: 'LOW' },
    { name: 'tni', risk: 'LOW' },
].sort((a, b) => b.name.length - a.name.length);
// ── RBA Geography mapping — area domisili individu (RBA internal)
// Sorted longest-first untuk cegah false positive substring match (Kepulauan Riau vs Riau).
const RBA_GEOGRAPHY_MAP = [
    // HIGH (+15)
    { name: 'dki jakarta', risk: 'HIGH' },
    { name: 'sumatera utara', risk: 'HIGH' },
    { name: 'north sumatra', risk: 'HIGH' },
    { name: 'jawa timur', risk: 'HIGH' },
    { name: 'jawa barat', risk: 'HIGH' },
    { name: 'jawa tengah', risk: 'HIGH' },
    { name: 'central java', risk: 'HIGH' },
    { name: 'east java', risk: 'HIGH' },
    { name: 'west java', risk: 'HIGH' },
    { name: 'jakarta', risk: 'HIGH' },
    { name: 'banten', risk: 'HIGH' },
    // MEDIUM (+7)
    { name: 'sulawesi selatan', risk: 'MEDIUM' },
    { name: 'south sulawesi', risk: 'MEDIUM' },
    { name: 'kepulauan riau', risk: 'MEDIUM' },
    { name: 'riau islands', risk: 'MEDIUM' },
    { name: 'kalimantan timur', risk: 'MEDIUM' },
    { name: 'east kalimantan', risk: 'MEDIUM' },
    { name: 'sumatera selatan', risk: 'MEDIUM' },
    { name: 'south sumatra', risk: 'MEDIUM' },
    { name: 'daerah istimewa yogyakarta', risk: 'MEDIUM' },
    { name: 'di yogyakarta', risk: 'MEDIUM' },
    { name: 'yogyakarta', risk: 'MEDIUM' },
    { name: 'bengkulu', risk: 'MEDIUM' },
    { name: 'lampung', risk: 'MEDIUM' },
    { name: 'bali', risk: 'MEDIUM' },
    { name: 'riau', risk: 'MEDIUM' },
    { name: 'diy', risk: 'MEDIUM' },
    // LOW (+0, info)
    { name: 'nanggroe aceh darussalam', risk: 'LOW' },
    { name: 'kalimantan tengah', risk: 'LOW' },
    { name: 'central kalimantan', risk: 'LOW' },
    { name: 'kalimantan barat', risk: 'LOW' },
    { name: 'west kalimantan', risk: 'LOW' },
    { name: 'nusa tenggara timur', risk: 'LOW' },
    { name: 'east nusa tenggara', risk: 'LOW' },
    { name: 'nusa tenggara barat', risk: 'LOW' },
    { name: 'west nusa tenggara', risk: 'LOW' },
    { name: 'kalimantan selatan', risk: 'LOW' },
    { name: 'south kalimantan', risk: 'LOW' },
    { name: 'sulawesi utara', risk: 'LOW' },
    { name: 'north sulawesi', risk: 'LOW' },
    { name: 'sulawesi tengah', risk: 'LOW' },
    { name: 'central sulawesi', risk: 'LOW' },
    { name: 'sulawesi tenggara', risk: 'LOW' },
    { name: 'southeast sulawesi', risk: 'LOW' },
    { name: 'maluku utara', risk: 'LOW' },
    { name: 'north maluku', risk: 'LOW' },
    { name: 'bangka belitung', risk: 'LOW' },
    { name: 'gorontalo', risk: 'LOW' },
    { name: 'papua', risk: 'LOW' },
    { name: 'aceh', risk: 'LOW' },
    { name: 'ntt', risk: 'LOW' },
    { name: 'ntb', risk: 'LOW' },
].sort((a, b) => b.name.length - a.name.length);
/** Ubah angka 0..100 ke level (threshold dipertahankan dari v1) */
function levelOf(score) {
    if (score >= 70)
        return "HIGH";
    if (score >= 40)
        return "MEDIUM";
    return "LOW";
}
let ApplicationsService = class ApplicationsService {
    constructor(pool) {
        this.pool = pool;
    }
    // ── CIF helpers ──────────────────────────────────────────────────────────────
    extractLast6Digits(value) {
        const digits = (value ?? "").replace(/\D/g, "");
        if (!digits)
            return "000000";
        return digits.slice(-6).padStart(6, "0");
    }
    async generateIndividualCif(identityNumber) {
        const last6 = this.extractLast6Digits(identityNumber);
        const { rows } = await this.pool.query(`SELECT nextval('cif_individual_seq') AS seq`);
        const seq = String(rows[0].seq).padStart(5, "0");
        return `KSH-I-${last6}-${seq}`;
    }
    async generateBusinessCif(nib, npwp) {
        const last6 = this.extractLast6Digits(nib || npwp);
        const { rows } = await this.pool.query(`SELECT nextval('cif_business_seq') AS seq`);
        const seq = String(rows[0].seq).padStart(5, "0");
        return `KSH-B-${last6}-${seq}`;
    }
    // Look up an existing CIF assigned to any person or BO party with the same
    // digit-normalized identity number. Prevents duplicate CIF for the same person
    // across OUR_CUSTOMER and BO contexts.
    async resolveCifForIdentity(rawIdentityNumber) {
        const norm = (rawIdentityNumber ?? "").replace(/\D/g, "");
        if (!norm)
            return null;
        const { rows: pr } = await this.pool.query(`SELECT cif_no FROM persons
       WHERE regexp_replace(COALESCE(identity_number,''), '[^0-9]', '', 'g') = $1
         AND cif_no IS NOT NULL
       LIMIT 1`, [norm]);
        if (pr[0]?.cif_no)
            return pr[0].cif_no;
        const { rows: bp } = await this.pool.query(`SELECT bp.cif_no
       FROM business_parties bp
       JOIN persons p ON p.id = bp.person_id
       WHERE regexp_replace(COALESCE(p.identity_number,''), '[^0-9]', '', 'g') = $1
         AND bp.cif_no IS NOT NULL
       LIMIT 1`, [norm]);
        return bp[0]?.cif_no ?? null;
    }
    // ─────────────────────────────────────────────────────────────────────────────
    // di src/modules/applications/applications.service.ts (dalam class ApplicationsService)
    async recomputeAutoBump(appId, reviewerId) {
        // cek apakah ada CONFIRMED DTTOT/PPPSPM
        const { rows: hits } = await this.pool.query(`SELECT list_type
     FROM screening_results
     WHERE application_id = $1
       AND review_status = 'CONFIRMED'
       AND list_type IN ('DTTOT','PPPSPM')
     LIMIT 1`, [appId]);
        if (hits.length) {
            const lt = hits[0].list_type;
            const reason = `AUTO_BUMP: CONFIRMED ${lt} hit`;
            // set/overwrite override hanya jika sebelumnya kosong atau juga AUTO_BUMP
            await this.pool.query(`INSERT INTO application_risk (application_id, risk_score, risk_level, factors,
                                     override_level, override_reason, override_by, override_at, created_at)
       VALUES ($1, 100, 'HIGH', COALESCE((SELECT factors FROM application_risk ar WHERE ar.application_id=$1),'{}'::jsonb),
               'HIGH', $2, $3, now(), now())
       ON CONFLICT (application_id) DO UPDATE SET
         override_level = CASE
           WHEN application_risk.override_reason IS NULL OR application_risk.override_reason LIKE 'AUTO_BUMP:%'
           THEN 'HIGH' ELSE application_risk.override_level END,
         override_reason = CASE
           WHEN application_risk.override_reason IS NULL OR application_risk.override_reason LIKE 'AUTO_BUMP:%'
           THEN EXCLUDED.override_reason ELSE application_risk.override_reason END,
         override_by = CASE
           WHEN application_risk.override_reason IS NULL OR application_risk.override_reason LIKE 'AUTO_BUMP:%'
           THEN EXCLUDED.override_by ELSE application_risk.override_by END,
         override_at = CASE
           WHEN application_risk.override_reason IS NULL OR application_risk.override_reason LIKE 'AUTO_BUMP:%'
           THEN now() ELSE application_risk.override_at END`, [appId, reason, reviewerId || null]);
            return;
        }
        // tidak ada CONFIRMED DTTOT/PPPSPM → bersihkan override kalau itu AUTO_BUMP
        await this.pool.query(`UPDATE application_risk
     SET override_level = NULL,
         override_reason = NULL,
         override_by = NULL,
         override_at = NULL
     WHERE application_id=$1
       AND override_reason LIKE 'AUTO_BUMP:%'`, [appId]);
    }
    // applications.service.ts
    async createIndividual(dto, userId, branchId) {
        const norm = (s) => (s || "").replace(/\D+/g, "").trim(); // buang non-digit untuk KTP
        if (dto.identity_type === "KTP")
            dto.identity_number = norm(dto.identity_number);
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            // 1) coba cari person existing (khususnya utk KTP)
            let personId = null;
            let personHasCif = false;
            const { rows: found } = await client.query(`SELECT id, cif_no FROM persons WHERE identity_type = $1 AND identity_number = $2 LIMIT 1`, [dto.identity_type, dto.identity_number]);
            if (found[0]) {
                personId = found[0].id;
                personHasCif = !!found[0].cif_no;
            }
            // 2) kalau belum ada, insert person baru
            if (!personId) {
                const ins = await client.query(`INSERT INTO persons (full_name, identity_type, identity_number, address_identity, address_residential,
                              pob, dob, nationality, phone, occupation, gender, email, signature_uri)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id`, [
                    dto.full_name,
                    dto.identity_type,
                    dto.identity_number,
                    dto.address_identity,
                    dto.address_residential || null,
                    dto.pob,
                    dto.dob,
                    dto.nationality,
                    dto.phone,
                    dto.occupation,
                    dto.gender,
                    dto.email || null,
                    dto.signature_uri || null,
                ]);
                personId = ins.rows[0].id;
            }
            // 3) Ensure person has a CIF. Covers: new person, and existing person created
            //    via addParty (e.g. as DIRECTOR) who never received a CIF.
            if (!personHasCif) {
                const existingCif = await this.resolveCifForIdentity(dto.identity_number);
                const cif = existingCif ?? (await this.generateIndividualCif(dto.identity_number));
                const relType = dto.cif_relationship_type || "OUR_CUSTOMER";
                await client.query(`UPDATE persons SET cif_no = $1, cif_relationship_type = $2 WHERE id = $3 AND cif_no IS NULL`, [cif, relType, personId]);
            }
            // 3) buat application dengan status DRAFT
            const appRes = await client.query(`INSERT INTO applications (type, status, branch_id, created_by, person_id)
       VALUES ('INDIVIDUAL','DRAFT',$1,$2,$3)
       RETURNING id, status`, [branchId || null, userId, personId]);
            const app = appRes.rows[0];
            await client.query("COMMIT");
            return app;
        }
        catch (e) {
            await client.query("ROLLBACK");
            // race condition fallback: jika bentrok unik, ambil person existing lalu lanjut bikin app
            if (e?.code === "23505") {
                const { rows } = await this.pool.query(`SELECT id FROM persons WHERE identity_type=$1 AND identity_number=$2 LIMIT 1`, [dto.identity_type, dto.identity_number]);
                const personId = rows[0]?.id;
                if (personId) {
                    const appRes = await this.pool.query(`INSERT INTO applications (type, status, branch_id, created_by, person_id)
           VALUES ('INDIVIDUAL','DRAFT',$1,$2,$3)
           RETURNING id, status`, [branchId || null, userId, personId]);
                    return appRes.rows[0];
                }
            }
            throw e;
        }
        finally {
            client.release();
        }
    }
    async isOnWatchlist(fullName, aliases, identityNumber) {
        const nameNorm = fullName.trim().toUpperCase();
        const aliasNorms = (aliases || []).map((a) => a.trim().toUpperCase());
        const q = await this.pool.query(`SELECT id FROM watchlist_entries
     WHERE name_norm = $1
        OR $2::text[] && aliases
        OR national_id_number = $3
     LIMIT 1`, [nameNorm, aliasNorms, identityNumber]);
        return (q.rowCount ?? 0) > 0; // true kalau ada di watchlist
    }
    async createBusiness(dto, userId, branchId) {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const q = await client.query(`INSERT INTO business_entities (legal_name, legal_form, incorporation_place, incorporation_date,
          business_license_number, nib, npwp, address_line, city, province, postal_code, business_activity, industry_code, phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`, [
                dto.legal_name,
                dto.legal_form,
                dto.incorporation_place,
                dto.incorporation_date,
                dto.business_license_number,
                dto.nib,
                dto.npwp,
                dto.address_line,
                dto.city,
                dto.province,
                dto.postal_code,
                dto.business_activity,
                dto.industry_code || null,
                dto.phone,
            ]);
            const businessId = q.rows[0].id;
            // Generate CIF — sequence is non-transactional, safe to call outside transaction
            const cif = await this.generateBusinessCif(dto.nib, dto.npwp);
            await client.query(`UPDATE business_entities SET cif_no = $1 WHERE id = $2`, [cif, businessId]);
            const appRes = await client.query(`INSERT INTO applications (type, status, branch_id, created_by, business_id)
         VALUES ('BUSINESS','DRAFT',$1,$2,$3)
         RETURNING id, status`, [branchId || null, userId, businessId]);
            await client.query("COMMIT");
            return appRes.rows[0];
        }
        catch (e) {
            await client.query("ROLLBACK");
            throw e;
        }
        finally {
            client.release();
        }
    }
    async addDocument(appId, dto) {
        const { rows: apps } = await this.pool.query(`SELECT id FROM applications WHERE id=$1`, [appId]);
        if (!apps[0])
            throw new common_1.NotFoundException("Application not found");
        const res = await this.pool.query(`INSERT INTO documents (application_id, doc_type, file_uri, status, extracted_json)
       VALUES ($1,$2,$3,'PENDING',$4)
       RETURNING id, application_id, doc_type, file_uri, status, extracted_json, created_at`, [appId, dto.doc_type, dto.file_uri, dto.extracted_json || null]);
        return res.rows[0];
    }
    async getDetail(appId) {
        const { rows: apps } = await this.pool.query(`SELECT * FROM applications WHERE id=$1`, [appId]);
        const app = apps[0];
        if (!app)
            throw new common_1.NotFoundException("Application not found");
        // person — semua field yang dibutuhkan FE
        let person = null;
        if (app.person_id) {
            const { rows: pr } = await this.pool.query(`SELECT id, full_name, identity_type, identity_number,
                pob, dob, nationality, phone, email, gender,
                occupation, address_identity, address_residential, signature_uri,
                pep_self_declared, cif_no, cif_relationship_type
         FROM persons WHERE id=$1`, [app.person_id]);
            person = pr[0] ?? null;
        }
        // business — semua field yang dibutuhkan FE
        let business = null;
        if (app.business_id) {
            const { rows: biz } = await this.pool.query(`SELECT id, legal_name, trade_name, legal_form,
                incorporation_place, incorporation_date,
                nib, npwp, address_line, city, province, postal_code,
                phone, industry_code, business_activity, cif_no
         FROM business_entities WHERE id=$1`, [app.business_id]);
            business = biz[0] ?? null;
        }
        // documents
        const { rows: docs } = await this.pool.query(`SELECT id, doc_type, file_uri, status, extracted_json, created_at
       FROM documents WHERE application_id=$1 ORDER BY created_at DESC`, [appId]);
        // parties (BUSINESS only)
        let parties = [];
        if (app.business_id) {
            const { rows } = await this.pool.query(`SELECT bp.id, bp.role, bp.is_active, bp.created_at,
                bp.cif_no, bp.cif_relationship_type,
                p.id as person_id, p.full_name, p.identity_type, p.identity_number
         FROM business_parties bp
         JOIN persons p ON p.id = bp.person_id
         WHERE bp.business_id = $1
         ORDER BY bp.created_at DESC`, [app.business_id]);
            parties = rows;
        }
        // risk (null kalau belum di-submit)
        const { rows: riskRows } = await this.pool.query(`SELECT application_id, risk_score::float AS risk_score, risk_level,
              factors, risk_factors,
              override_level, override_reason, override_by, override_at, created_at
       FROM application_risk WHERE application_id=$1`, [appId]);
        const risk = riskRows[0] ?? null;
        // edd summary — selalu ada key edd_required & edd_completed
        const { rows: eddRows } = await this.pool.query(`SELECT edd_required, edd_completed FROM application_edd WHERE application_id=$1`, [appId]);
        const edd = eddRows[0]
            ? { edd_required: eddRows[0].edd_required, edd_completed: eddRows[0].edd_completed }
            : { edd_required: false, edd_completed: false };
        return { application: app, person, business, documents: docs, parties, risk, edd };
    }
    async validateBeforeSubmit(appId) {
        const { rows } = await this.pool.query(`SELECT id, type, person_id, business_id FROM applications WHERE id=$1`, [appId]);
        const app = rows[0];
        if (!app)
            throw new common_1.NotFoundException("Application not found");
        // ambil dokumen
        const { rows: docs } = await this.pool.query(`SELECT doc_type FROM documents WHERE application_id=$1`, [appId]);
        const docSet = new Set(docs.map((d) => d.doc_type));
        if (app.type === "INDIVIDUAL") {
            const { rows: pr } = await this.pool.query(`SELECT signature_uri FROM persons WHERE id=$1`, [app.person_id]);
            const person = pr[0];
            const missing = [];
            // signature valid jika persons.signature_uri terisi ATAU ada dokumen SIGNATURE
            const hasSignature = !!person?.signature_uri || docSet.has("SIGNATURE");
            if (!hasSignature)
                missing.push("signature_uri (tanda tangan)");
            if (!(docSet.has("KTP") || docSet.has("SIM") || docSet.has("PASPOR"))) {
                missing.push("dokumen identitas (KTP/SIM/PASPOR)");
            }
            if (missing.length) {
                throw new common_1.BadRequestException({
                    message: "INDIVIDUAL belum lengkap untuk submit",
                    missing,
                });
            }
            return { ok: true };
        }
        if (app.type === "BUSINESS") {
            // dokumen wajib korporasi
            const needDocs = ["AKTA_PENDIRIAN", "NIB_SIUP", "NPWP_BADAN"];
            const missingDocs = needDocs.filter((d) => !docSet.has(d));
            // parties wajib
            const { rows: parties } = await this.pool.query(`SELECT role FROM business_parties WHERE business_id=$1 AND is_active = TRUE`, [app.business_id]);
            const roles = new Set(parties.map((p) => p.role));
            const hasPengurus = roles.has("DIRECTOR") || roles.has("COMMISSIONER");
            const hasBO = roles.has("BO");
            const hasAuthRep = roles.has("AUTHORIZED_REP");
            const hasAnyRequiredParty = hasPengurus || hasBO || hasAuthRep;
            const missing = [];
            if (missingDocs.length)
                missing.push(`dokumen korporasi: ${missingDocs.join(", ")}`);
            if (!hasAnyRequiredParty)
                missing.push("minimal 1 party: (DIRECTOR/COMMISSIONER) atau BO atau AUTHORIZED_REP");
            if (missing.length) {
                throw new common_1.BadRequestException({
                    message: "BUSINESS belum lengkap untuk submit",
                    missing,
                });
            }
            return { ok: true };
        }
        // fallback
        return { ok: true };
    }
    /**
     * Internal Preliminary Risk Scoring — RBA v2.
     * Bukan formula resmi BI. Digunakan sebagai dasar review compliance internal.
     */
    async screenAndComputeRisk(appId) {
        // ── 1. Ambil aplikasi ──
        const { rows: apps } = await this.pool.query(`SELECT id, type, person_id, business_id FROM applications WHERE id=$1`, [appId]);
        const app = apps[0];
        if (!app)
            throw new common_1.NotFoundException("Application not found");
        const subjects = [];
        if (app.type === "INDIVIDUAL") {
            const { rows: p } = await this.pool.query(`SELECT id, full_name AS name, dob::text AS dob, nationality FROM persons WHERE id=$1`, [app.person_id]);
            if (p[0])
                subjects.push({ subject_type: "INDIVIDUAL", name: p[0].name, dob: p[0].dob, nationality: p[0].nationality, ref: p[0].id });
        }
        else if (app.type === "BUSINESS") {
            const { rows: b } = await this.pool.query(`SELECT id, legal_name AS name, country AS nationality FROM business_entities WHERE id=$1`, [app.business_id]);
            if (b[0])
                subjects.push({ subject_type: "BUSINESS", name: b[0].name, nationality: b[0].nationality || null, ref: b[0].id });
            const { rows: parties } = await this.pool.query(`SELECT bp.id as party_id, p.full_name as name, p.dob::text as dob, p.nationality
         FROM business_parties bp
         JOIN persons p ON p.id = bp.person_id
         WHERE bp.business_id=$1 AND bp.is_active = TRUE`, [app.business_id]);
            for (const r of parties)
                subjects.push({ subject_type: "PARTY", name: r.name, dob: r.dob, nationality: r.nationality, ref: r.party_id });
        }
        // ── 3. Bersihkan screening lama & jalankan screening baru ──
        await this.pool.query(`DELETE FROM screening_results WHERE application_id=$1`, [appId]);
        for (const s of subjects) {
            const expr = `upper(regexp_replace($1, '\\s+', ' ', 'g'))`;
            const { rows: candidates } = await this.pool.query(`SELECT id, list_type, name, date_of_birth, nationality,
                similarity(name_norm, ${expr}) AS score
         FROM watchlist_entries
         WHERE name_norm % ${expr}
            OR (aliases_concat IS NOT NULL AND aliases_concat % ${expr})
         ORDER BY score DESC LIMIT 30`, [s.name]);
            for (const c of candidates) {
                if (Number(c.score) < SIMILARITY_THRESHOLD)
                    continue;
                // entity_ref CHECK constraint: 'PERSON' | 'BUSINESS' | 'BO'
                const entityRef = s.subject_type === "BUSINESS" ? "BUSINESS" : "PERSON";
                await this.pool.query(`INSERT INTO screening_results
             (application_id, subject_type, entity_ref, subject_ref, ref_id,
              list_type, watchlist_id,
              matched_name, matched_dob, matched_nationality, score)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [appId, s.subject_type, entityRef, s.ref || null, s.ref,
                    c.list_type, c.id,
                    c.name, c.date_of_birth || null, c.nationality || null, c.score]);
            }
        }
        // ── 4. Baca kembali hasil screening dikelompokkan ──
        const { rows: hitRows } = await this.pool.query(`SELECT list_type,
              COALESCE(review_status::text, 'UNREVIEWED') AS review_status,
              COUNT(*)::int                               AS cnt,
              MAX(score::float)                           AS top_score,
              MAX(matched_name)                           AS top_name
       FROM screening_results
       WHERE application_id=$1
       GROUP BY list_type, COALESCE(review_status::text, 'UNREVIEWED')`, [appId]);
        // ── 5. Faktor: watchlist / sanctions ──
        const riskFactors = [];
        let score = 0;
        for (const h of hitRows) {
            if (["FALSE_POSITIVE", "DISMISSED"].includes(h.review_status))
                continue;
            const confirmed = h.review_status === "CONFIRMED";
            const topPct = `${((h.top_score ?? 0) * 100).toFixed(0)}%`;
            if (h.list_type === "DTTOT") {
                const pts = confirmed ? W.DTTOT_CONFIRMED : W.DTTOT_CANDIDATE;
                score += pts;
                riskFactors.push({ code: confirmed ? "WATCHLIST_DTTOT_CONFIRMED" : "WATCHLIST_DTTOT_CANDIDATE", label: confirmed ? "DTTOT confirmed match" : "DTTOT candidate match (belum direview)", score: pts, severity: confirmed ? "CRITICAL" : "HIGH", source: "screening", details: `${h.cnt} match, similarity tertinggi ${topPct}, nama: ${h.top_name}` });
            }
            else if (h.list_type === "PPPSPM") {
                const pts = confirmed ? W.PPPSPM_CONFIRMED : W.PPPSPM_CANDIDATE;
                score += pts;
                riskFactors.push({ code: confirmed ? "WATCHLIST_PPPSPM_CONFIRMED" : "WATCHLIST_PPPSPM_CANDIDATE", label: confirmed ? "PPPSPM confirmed match" : "PPPSPM candidate match (belum direview)", score: pts, severity: confirmed ? "CRITICAL" : "HIGH", source: "screening", details: `${h.cnt} match, similarity tertinggi ${topPct}, nama: ${h.top_name}` });
            }
            else if (h.list_type === "PEP") {
                const pts = confirmed ? W.PEP_CONFIRMED : W.PEP_CANDIDATE;
                score += pts;
                riskFactors.push({ code: confirmed ? "WATCHLIST_PEP_CONFIRMED" : "WATCHLIST_PEP_CANDIDATE", label: confirmed ? "PEP confirmed match" : "PEP candidate match (belum direview)", score: pts, severity: confirmed ? "HIGH" : "MEDIUM", source: "screening", details: `${h.cnt} match, similarity tertinggi ${topPct}, nama: ${h.top_name}` });
            }
        }
        // ── 6. Faktor: profil individu ──
        if (app.type === "INDIVIDUAL") {
            const { rows: pr } = await this.pool.query(`SELECT occupation, pep_self_declared, nationality, address_identity, address_residential FROM persons WHERE id=$1`, [app.person_id]);
            const p = pr[0] ?? {};
            if (p.pep_self_declared) {
                score += W.PEP_SELF_DECLARED;
                riskFactors.push({ code: "INDIVIDUAL_PEP_SELF_DECLARED", label: "PEP self-declared oleh pemohon", score: W.PEP_SELF_DECLARED, severity: "HIGH", source: "profile" });
            }
            const occ = (p.occupation || "").toLowerCase();
            const matchedOcc = HIGH_RISK_OCCUPATIONS.find((k) => occ.includes(k));
            if (matchedOcc) {
                score += W.HIGH_RISK_OCCUPATION;
                riskFactors.push({ code: "INDIVIDUAL_HIGH_RISK_OCCUPATION", label: "Pekerjaan berisiko tinggi", score: W.HIGH_RISK_OCCUPATION, severity: "MEDIUM", source: "profile", details: `Pekerjaan: ${p.occupation}` });
            }
            // ── RBA: profil pekerjaan (occupation risk) ──
            const occNorm = (p.occupation || "").trim().toLowerCase();
            const rbaOcc = RBA_OCCUPATION_MAP.find(e => occNorm.includes(e.name));
            if (rbaOcc) {
                const pts = rbaOcc.risk === "HIGH" ? W.RBA_OCC_HIGH : rbaOcc.risk === "MEDIUM" ? W.RBA_OCC_MEDIUM : 0;
                score += pts;
                riskFactors.push({
                    code: `INDIVIDUAL_OCCUPATION_${rbaOcc.risk}_RBA`,
                    label: `Profil pekerjaan ${rbaOcc.risk.toLowerCase()} risk (RBA)`,
                    score: pts,
                    severity: rbaOcc.risk === "HIGH" ? "HIGH" : rbaOcc.risk === "MEDIUM" ? "MEDIUM" : "LOW",
                    source: "rba_occupation",
                    metadata: { matched: rbaOcc.name, source: "occupation" },
                });
            }
            // ── RBA: area geografis domisili (address risk) ──
            const addrIdent = (p.address_identity || "").trim().toLowerCase();
            const addrResi = (p.address_residential || "").trim().toLowerCase();
            const addrText = `${addrIdent} ${addrResi}`.trim();
            const rbaGeo = RBA_GEOGRAPHY_MAP.find(e => addrText.includes(e.name));
            if (rbaGeo) {
                const pts = rbaGeo.risk === "HIGH" ? W.RBA_GEO_HIGH : rbaGeo.risk === "MEDIUM" ? W.RBA_GEO_MEDIUM : 0;
                score += pts;
                const geoSource = addrIdent.includes(rbaGeo.name) ? "address_identity"
                    : addrResi.includes(rbaGeo.name) ? "address_residential"
                        : "address";
                riskFactors.push({
                    code: `GEOGRAPHY_${rbaGeo.risk}_RBA`,
                    label: `Area geografis ${rbaGeo.risk.toLowerCase()} risk berdasarkan RBA`,
                    score: pts,
                    severity: rbaGeo.risk === "HIGH" ? "HIGH" : rbaGeo.risk === "MEDIUM" ? "MEDIUM" : "LOW",
                    source: "rba_geography",
                    metadata: { matched: rbaGeo.name, source: geoSource },
                });
            }
            const nat = (p.nationality || "").toUpperCase();
            if (HIGH_RISK_COUNTRIES.length && HIGH_RISK_COUNTRIES.includes(nat)) {
                score += W.GEOGRAPHY;
                riskFactors.push({ code: "GEOGRAPHY_HIGH_RISK_NATIONALITY", label: "Kewarganegaraan negara berisiko tinggi", score: W.GEOGRAPHY, severity: "MEDIUM", source: "geography", details: `Nationality: ${nat}` });
            }
        }
        // ── 7. Faktor: profil bisnis ──
        if (app.type === "BUSINESS") {
            const { rows: bizRows } = await this.pool.query(`SELECT business_activity, legal_form, country FROM business_entities WHERE id=$1`, [app.business_id]);
            const biz = bizRows[0] ?? {};
            const activity = (biz.business_activity || "").toLowerCase();
            const matchedAct = HIGH_RISK_ACTIVITIES.find((k) => activity.includes(k));
            if (matchedAct) {
                score += W.HIGH_RISK_ACTIVITY;
                riskFactors.push({ code: "BUSINESS_HIGH_RISK_ACTIVITY", label: "Kegiatan usaha berisiko tinggi", score: W.HIGH_RISK_ACTIVITY, severity: "MEDIUM", source: "profile", details: `Kegiatan: ${biz.business_activity}` });
            }
            const lf = (biz.legal_form || "").toUpperCase();
            if (HIGH_RISK_LEGAL_FORMS.some((f) => lf.includes(f))) {
                score += W.HIGH_RISK_LEGAL_FORM;
                riskFactors.push({ code: "BUSINESS_HIGH_RISK_LEGAL_FORM", label: "Bentuk hukum berisiko tinggi", score: W.HIGH_RISK_LEGAL_FORM, severity: "LOW", source: "profile", details: `Bentuk hukum: ${biz.legal_form}` });
            }
            const { rows: boRows } = await this.pool.query(`SELECT 1 FROM business_parties WHERE business_id=$1 AND role='BO' AND is_active=TRUE LIMIT 1`, [app.business_id]);
            if (!boRows.length) {
                score += W.BO_MISSING;
                riskFactors.push({ code: "BUSINESS_BO_MISSING", label: "Beneficial Owner (BO) belum terdaftar", score: W.BO_MISSING, severity: "HIGH", source: "profile" });
            }
            const country = (biz.country || "").toUpperCase();
            if (HIGH_RISK_COUNTRIES.length && HIGH_RISK_COUNTRIES.includes(country)) {
                score += W.GEOGRAPHY;
                riskFactors.push({ code: "GEOGRAPHY_HIGH_RISK_COUNTRY", label: "Negara asal/domisili bisnis berisiko tinggi", score: W.GEOGRAPHY, severity: "MEDIUM", source: "geography", details: `Country: ${country}` });
            }
        }
        // ── 8. Faktor: dokumen ──
        const { rows: docRows } = await this.pool.query(`SELECT doc_type, status FROM documents WHERE application_id=$1`, [appId]);
        const docTypes = new Set(docRows.map((d) => d.doc_type));
        if (app.type === "INDIVIDUAL") {
            if (!["KTP", "SIM", "PASPOR"].some((d) => docTypes.has(d))) {
                score += W.DOC_MISSING;
                riskFactors.push({ code: "DOC_IDENTITY_MISSING", label: "Dokumen identitas belum diunggah (KTP/SIM/PASPOR)", score: W.DOC_MISSING, severity: "MEDIUM", source: "document" });
            }
        }
        else {
            for (const req of ["AKTA_PENDIRIAN", "NIB_SIUP", "NPWP_BADAN"]) {
                if (!docTypes.has(req)) {
                    score += W.DOC_MISSING;
                    riskFactors.push({ code: `DOC_${req}_MISSING`, label: `Dokumen wajib belum ada: ${req}`, score: W.DOC_MISSING, severity: "MEDIUM", source: "document" });
                }
            }
        }
        for (const doc of docRows.filter((d) => d.status === "REJECTED")) {
            score += W.DOC_REJECTED;
            riskFactors.push({ code: "DOC_REJECTED", label: "Dokumen ditolak", score: W.DOC_REJECTED, severity: "MEDIUM", source: "document", details: `Tipe: ${doc.doc_type}` });
        }
        // ── 9. Faktor netral: channel onboarding ──
        riskFactors.push({
            code: "ONBOARDING_OFFLINE_DIRECT",
            label: "Channel onboarding: offline/tatap muka (default)",
            score: 0,
            severity: "INFO",
            source: "channel",
            details: "Diasumsikan offline direct; kolom onboarding_channel belum ada di schema",
        });
        // ── 10. Cap 0..100, tentukan level ──
        score = Math.max(0, Math.min(100, score));
        // PEP detection forces risk_level HIGH regardless of computed score.
        // Score is also raised to minimum 70 for consistency with HIGH threshold.
        const PEP_RISK_CODES = [
            "WATCHLIST_PEP_CONFIRMED",
            "WATCHLIST_PEP_CANDIDATE",
            "INDIVIDUAL_PEP_SELF_DECLARED",
        ];
        const hasPep = riskFactors.some((f) => PEP_RISK_CODES.includes(f.code));
        if (hasPep)
            score = Math.max(score, 70);
        const risk_level = hasPep ? "HIGH" : levelOf(score);
        // ── 11. Legacy factors (backward compat untuk kolom factors) ──
        const hitSummary = hitRows
            .filter((h) => !["FALSE_POSITIVE", "DISMISSED"].includes(h.review_status))
            .reduce((acc, h) => {
            if (h.list_type === "PEP")
                acc.pep += h.cnt;
            if (h.list_type === "DTTOT")
                acc.dttot += h.cnt;
            if (h.list_type === "PPPSPM")
                acc.pppspm += h.cnt;
            return acc;
        }, { pep: 0, dttot: 0, pppspm: 0 });
        const factors = {
            version: "rba_v2",
            hits: hitSummary,
            score_breakdown: riskFactors.filter((f) => f.score > 0).map((f) => ({ code: f.code, score: f.score })),
            threshold: SIMILARITY_THRESHOLD,
        };
        // ── 12. Simpan ke DB ──
        await this.pool.query(`INSERT INTO application_risk
         (application_id, risk_score, risk_level, factors, risk_factors, created_at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (application_id) DO UPDATE SET
         risk_score    = EXCLUDED.risk_score,
         risk_level    = EXCLUDED.risk_level,
         factors       = EXCLUDED.factors,
         risk_factors  = EXCLUDED.risk_factors,
         created_at    = now()`, [appId, score, risk_level, JSON.stringify(factors), JSON.stringify(riskFactors)]);
        return { risk_score: score, risk_level, factors, risk_factors: riskFactors };
    }
    // List parties for a BUSINESS application
    async listParties(appId) {
        // pastikan application-nya BUSINESS
        const { rows: appRows } = await this.pool.query(`SELECT id, business_id, type FROM applications WHERE id=$1`, [appId]);
        const app = appRows[0];
        if (!app)
            throw new common_1.NotFoundException("Application not found");
        if (app.type !== "BUSINESS" || !app.business_id)
            throw new common_1.BadRequestException("Parties only apply to BUSINESS applications");
        const { rows } = await this.pool.query(`SELECT bp.id, bp.role, bp.is_active, bp.created_at,
              bp.cif_no, bp.cif_relationship_type,
              p.id AS person_id, p.full_name, p.identity_type, p.identity_number, p.dob, p.nationality
       FROM business_parties bp
       JOIN persons p ON p.id = bp.person_id
       WHERE bp.business_id = $1
       ORDER BY bp.created_at DESC`, [app.business_id]);
        return rows;
    }
    // Create / upsert person, then attach into business_parties
    async addParty(appId, dto) {
        const { rows: appRows } = await this.pool.query(`SELECT id, business_id, type FROM applications WHERE id=$1`, [appId]);
        const app = appRows[0];
        if (!app)
            throw new common_1.NotFoundException("Application not found");
        if (app.type !== "BUSINESS" || !app.business_id)
            throw new common_1.BadRequestException("Parties only apply to BUSINESS applications");
        // Normalise KTP number (strip non-digits) consistent with createIndividual
        if (dto.identity_type === "KTP")
            dto.identity_number = (dto.identity_number || "").replace(/\D+/g, "").trim();
        // cari existing person by (identity_type, identity_number)
        const { rows: existing } = await this.pool.query(`SELECT id FROM persons WHERE identity_type=$1 AND identity_number=$2 LIMIT 1`, [dto.identity_type, dto.identity_number]);
        let personId;
        if (existing[0]) {
            personId = existing[0].id;
            // optional: update data dasar
            await this.pool.query(`UPDATE persons
       SET full_name=COALESCE($1, full_name),
           dob=COALESCE($2::date, dob),
           nationality=COALESCE($3, nationality),
           phone=COALESCE($4, phone),
           email=COALESCE($5, email)
       WHERE id=$6`, [
                dto.full_name || null,
                dto.dob || null,
                dto.nationality || null,
                dto.phone || null,
                dto.email || null,
                personId,
            ]);
        }
        else {
            const ins = await this.pool.query(`INSERT INTO persons (full_name, identity_type, identity_number, dob, nationality, phone, email)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [
                dto.full_name,
                dto.identity_type,
                dto.identity_number,
                dto.dob || null,
                dto.nationality || null,
                dto.phone || null,
                dto.email || null,
            ]);
            personId = ins.rows[0].id;
        }
        // CIF resolution for BO parties (and sync to persons so OUR_CUSTOMER apps reuse it)
        let partyCif = null;
        if (dto.role === "BO") {
            partyCif = await this.resolveCifForIdentity(dto.identity_number);
            if (!partyCif) {
                partyCif = await this.generateIndividualCif(dto.identity_number);
            }
            // Sync CIF to persons so a future individual application for same NIK reuses it
            await this.pool.query(`UPDATE persons SET cif_no = COALESCE(cif_no, $1) WHERE id = $2`, [partyCif, personId]);
        }
        // insert ke business_parties (unique per business/person/role)
        const party = await this.pool.query(`INSERT INTO business_parties (business_id, person_id, role, is_active, cif_no, cif_relationship_type)
     VALUES ($1,$2,$3,TRUE,$4,$5)
     ON CONFLICT (business_id, person_id, role) DO UPDATE
       SET is_active = TRUE,
           cif_no = COALESCE(business_parties.cif_no, EXCLUDED.cif_no)
     RETURNING id, business_id, person_id, role, is_active, created_at, cif_no, cif_relationship_type`, [app.business_id, personId, dto.role, partyCif, dto.role === "BO" ? "BO" : null]);
        return party.rows[0];
    }
    async deleteParty(appId, partyId) {
        const { rows: appRows } = await this.pool.query(`SELECT id, business_id, type FROM applications WHERE id=$1`, [appId]);
        const app = appRows[0];
        if (!app)
            throw new common_1.NotFoundException("Application not found");
        if (app.type !== "BUSINESS" || !app.business_id)
            throw new common_1.BadRequestException("Parties only apply to BUSINESS applications");
        const { rows } = await this.pool.query(`DELETE FROM business_parties WHERE id=$1 AND business_id=$2 RETURNING id`, [partyId, app.business_id]);
        if (!rows[0])
            throw new common_1.NotFoundException("Party not found");
        return { ok: true };
    }
    async submit(appId, reviewerId) {
        await this.validateBeforeSubmit(appId);
        const res = await this.pool.query(`UPDATE applications
     SET status='SUBMITTED', submitted_at=now(), reviewer_id=$2
     WHERE id=$1
     RETURNING id`, [appId, reviewerId]);
        if (!res.rows[0])
            throw new common_1.NotFoundException("Application not found");
        // <<< SCREEN & RISK otomatis setelah submit >>>
        const risk = await this.screenAndComputeRisk(appId);
        // HIGH RISK → set IN_REVIEW + wajibkan EDD
        if (risk.risk_level === "HIGH") {
            await this.pool.query(`UPDATE applications SET status='IN_REVIEW', updated_at=now() WHERE id=$1`, [appId]);
            await this.initEddForHighRisk(appId, reviewerId);
            return { id: appId, status: "IN_REVIEW", risk };
        }
        return { id: appId, status: "SUBMITTED", risk };
    }
    async initEddForHighRisk(appId, reviewerId) {
        const { rows: apps } = await this.pool.query(`SELECT type, person_id, business_id FROM applications WHERE id=$1`, [appId]);
        const app = apps[0];
        if (!app)
            return;
        let snapshot = { cdd_reference_no: String(appId) };
        if (app.type === "INDIVIDUAL" && app.person_id) {
            const { rows: p } = await this.pool.query(`SELECT full_name, identity_number, identity_type, address_identity, occupation, phone
         FROM persons WHERE id=$1`, [app.person_id]);
            if (p[0]) {
                snapshot = {
                    ...snapshot,
                    full_name: p[0].full_name,
                    identity_number: p[0].identity_number,
                    identity_type: p[0].identity_type,
                    domicile_address: p[0].address_identity,
                    occupation_or_business_type: p[0].occupation,
                    phone_number: p[0].phone,
                    customer_category: "INDIVIDUAL",
                };
            }
        }
        else if (app.type === "BUSINESS" && app.business_id) {
            const { rows: b } = await this.pool.query(`SELECT legal_name, npwp, address_line, business_activity, phone
         FROM business_entities WHERE id=$1`, [app.business_id]);
            if (b[0]) {
                snapshot = {
                    ...snapshot,
                    full_name: b[0].legal_name,
                    identity_number: b[0].npwp,
                    identity_type: "NPWP_BADAN",
                    domicile_address: b[0].address_line,
                    occupation_or_business_type: b[0].business_activity,
                    phone_number: b[0].phone,
                    customer_category: "BUSINESS",
                };
            }
        }
        await this.pool.query(`INSERT INTO application_edd
         (application_id, edd_required, edd_completed, applicant_snapshot,
          created_by, updated_by, created_at, updated_at)
       VALUES ($1, true, false, $2, $3, $3, now(), now())
       ON CONFLICT (application_id) DO UPDATE SET
         edd_required  = true,
         applicant_snapshot = EXCLUDED.applicant_snapshot,
         updated_by    = $3,
         updated_at    = now()`, [appId, JSON.stringify(snapshot), reviewerId]);
    }
    async list(limit = 20, offset = 0) {
        const { rows } = await this.pool.query(`SELECT a.id, a.type, a.status, a.created_at,
              p.full_name as person_name, b.legal_name as business_name
       FROM applications a
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       ORDER BY a.created_at DESC
       LIMIT $1 OFFSET $2`, [limit, offset]);
        return rows;
    }
    async listDocuments(appId) {
        const { rows: apps } = await this.pool.query(`SELECT id FROM applications WHERE id=$1`, [appId]);
        if (!apps[0])
            throw new common_1.NotFoundException("Application not found");
        const { rows } = await this.pool.query(`SELECT id, doc_type, file_uri, status, extracted_json, created_at
       FROM documents
       WHERE application_id=$1
       ORDER BY created_at DESC`, [appId]);
        return rows;
    }
    async getScreening(appId) {
        const { rows: results } = await this.pool.query(`SELECT id, subject_type, subject_ref, list_type, watchlist_id, matched_name, matched_dob,
            matched_nationality, score, review_status, review_notes, reviewed_by, reviewed_at, created_at
     FROM screening_results
     WHERE application_id=$1
     ORDER BY score DESC, created_at DESC`, [appId]);
        const { rows: risk } = await this.pool.query(`SELECT application_id, risk_score, risk_level, factors,
            override_level, override_reason, override_by, override_at, created_at
     FROM application_risk WHERE application_id=$1`, [appId]);
        return { results, risk: risk[0] || null };
    }
    async reviewScreeningResult(appId, resultId, status, notes, reviewerId) {
        const { rows } = await this.pool.query(`UPDATE screening_results
     SET review_status=$1, review_notes=$2, reviewed_by=$3, reviewed_at=now()
     WHERE id=$4 AND application_id=$5
     RETURNING id`, [status, notes || null, reviewerId, resultId, appId]);
        if (!rows[0])
            throw new common_1.NotFoundException("Screening result not found");
        // ⬇️ cek & terapkan auto-bump (atau bersihkan bila tak perlu)
        await this.recomputeAutoBump(appId, reviewerId);
        return { ok: true };
    }
    async overrideRisk(appId, level, reason, reviewerId) {
        const { rows } = await this.pool.query(`UPDATE application_risk
     SET override_level=$2, override_reason=$3, override_by=$4, override_at=now()
     WHERE application_id=$1
     RETURNING application_id`, [appId, level, reason, reviewerId]);
        if (!rows[0]) {
            // kalau belum ada row risk (harusnya ada setelah submit), buat baru minimal
            await this.pool.query(`INSERT INTO application_risk (application_id, risk_score, risk_level, factors,
                                     override_level, override_reason, override_by, override_at, created_at)
       VALUES ($1, 0, 'LOW', '{}', $2, $3, $4, now(), now())`, [appId, level, reason, reviewerId]);
        }
        return { ok: true };
    }
    async listWithRisk(limit = 20, offset = 0) {
        const { rows } = await this.pool.query(`SELECT a.id, a.type, a.status, a.created_at, a.submitted_at,
            COALESCE(ar.override_level, ar.risk_level) AS risk_level,
            ar.risk_score,
            CASE WHEN ar.override_level IS NOT NULL THEN true ELSE false END AS risk_overridden
     FROM applications a
     LEFT JOIN application_risk ar ON ar.application_id = a.id
     ORDER BY a.created_at DESC
     LIMIT $1 OFFSET $2`, [limit, offset]);
        return rows;
    }
    async getDocument(appId, docId) {
        const { rows } = await this.pool.query(`SELECT id, application_id, doc_type, file_uri, status, extracted_json
       FROM documents
       WHERE id=$1`, [docId]);
        const doc = rows[0];
        if (!doc)
            throw new common_1.NotFoundException("Document not found");
        if (doc.application_id !== appId)
            throw new common_1.ForbiddenException("Document does not belong to this application");
        return doc;
    }
    async deleteDocument(appId, docId) {
        const doc = await this.getDocument(appId, docId);
        await this.pool.query(`DELETE FROM documents WHERE id=$1`, [docId]);
        return doc;
    }
    async getApplicationType(appId) {
        const { rows } = await this.pool.query(`SELECT type FROM applications WHERE id=$1`, [appId]);
        if (!rows[0])
            throw new common_1.NotFoundException('Application not found');
        return rows[0].type;
    }
    // ──────────────────────────────────────────────────────────────────────────
    // EDD — Enhanced Due Diligence (Lampiran 2 Formulir EDD APU PPT PPPSPM)
    // ──────────────────────────────────────────────────────────────────────────
    async getEdd(appId) {
        const { rows: apps } = await this.pool.query(`SELECT id FROM applications WHERE id=$1`, [appId]);
        if (!apps[0])
            throw new common_1.NotFoundException("Application not found");
        const { rows } = await this.pool.query(`SELECT * FROM application_edd WHERE application_id=$1`, [appId]);
        if (!rows[0]) {
            return {
                application_id: appId,
                edd_required: false,
                edd_completed: false,
                applicant_snapshot: {},
                high_risk_reasons: {},
                additional_information: {},
                beneficial_owner: {},
                officer_analysis: {},
                compliance_decision: {},
                director_decision: {},
                internal_checklist: {},
                completed_by: null,
                completed_at: null,
                created_by: null,
                updated_by: null,
                created_at: null,
                updated_at: null,
            };
        }
        return rows[0];
    }
    async saveEdd(appId, body, userId) {
        const { complete = false } = body;
        const { rows: apps } = await this.pool.query(`SELECT id FROM applications WHERE id=$1`, [appId]);
        if (!apps[0])
            throw new common_1.NotFoundException("Application not found");
        // Baca state saat ini untuk merge
        const { rows: existing } = await this.pool.query(`SELECT * FROM application_edd WHERE application_id=$1`, [appId]);
        const curr = existing[0];
        const merged = {
            applicant_snapshot: body.applicant_snapshot ?? curr?.applicant_snapshot ?? {},
            high_risk_reasons: body.high_risk_reasons ?? curr?.high_risk_reasons ?? {},
            additional_information: body.additional_information ?? curr?.additional_information ?? {},
            beneficial_owner: body.beneficial_owner ?? curr?.beneficial_owner ?? {},
            officer_analysis: body.officer_analysis ?? curr?.officer_analysis ?? {},
            compliance_decision: body.compliance_decision ?? curr?.compliance_decision ?? {},
            director_decision: body.director_decision ?? curr?.director_decision ?? {},
            internal_checklist: body.internal_checklist ?? curr?.internal_checklist ?? {},
        };
        if (complete)
            this.validateEddCompletion(merged);
        await this.pool.query(`INSERT INTO application_edd
         (application_id, edd_required, edd_completed,
          applicant_snapshot, high_risk_reasons, additional_information,
          beneficial_owner, officer_analysis, compliance_decision,
          director_decision, internal_checklist,
          completed_by, completed_at, created_by, updated_by, created_at, updated_at)
       VALUES ($1, false, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11, $12, $13, $13, now(), now())
       ON CONFLICT (application_id) DO UPDATE SET
         edd_completed          = CASE WHEN $2 THEN true ELSE application_edd.edd_completed END,
         applicant_snapshot     = $3,
         high_risk_reasons      = $4,
         additional_information = $5,
         beneficial_owner       = $6,
         officer_analysis       = $7,
         compliance_decision    = $8,
         director_decision      = $9,
         internal_checklist     = $10,
         completed_by           = CASE WHEN $2 THEN $11 ELSE application_edd.completed_by END,
         completed_at           = CASE WHEN $2 THEN $12 ELSE application_edd.completed_at END,
         updated_by             = $13,
         updated_at             = now()`, [
            appId,
            complete,
            JSON.stringify(merged.applicant_snapshot),
            JSON.stringify(merged.high_risk_reasons),
            JSON.stringify(merged.additional_information),
            JSON.stringify(merged.beneficial_owner),
            JSON.stringify(merged.officer_analysis),
            JSON.stringify(merged.compliance_decision),
            JSON.stringify(merged.director_decision),
            JSON.stringify(merged.internal_checklist),
            complete ? userId : null,
            complete ? new Date().toISOString() : null,
            userId,
        ]);
        return this.getEdd(appId);
    }
    validateEddCompletion(merged) {
        const errors = [];
        const snapshot = merged.applicant_snapshot ?? {};
        const hr = merged.high_risk_reasons ?? {};
        const addInfo = merged.additional_information ?? {};
        const officer = merged.officer_analysis ?? {};
        const compliance = merged.compliance_decision ?? {};
        const checklist = merged.internal_checklist ?? {};
        if (!snapshot.full_name && !snapshot.cdd_reference_no)
            errors.push("applicant_snapshot: full_name atau cdd_reference_no wajib diisi");
        const hrCats = ["customer_characteristics", "transaction_patterns", "screening_results", "clarification_requests"];
        if (!hrCats.some((c) => Array.isArray(hr[c]) && hr[c].length > 0))
            errors.push("high_risk_reasons: minimal 1 kategori dengan minimal 1 alasan");
        if (!officer.overall_risk_summary)
            errors.push("officer_analysis.overall_risk_summary wajib diisi");
        if (!Array.isArray(officer.follow_up_recommendations) || officer.follow_up_recommendations.length === 0)
            errors.push("officer_analysis.follow_up_recommendations minimal 1 item");
        if (!compliance.decision)
            errors.push("compliance_decision.decision wajib diisi");
        if (!checklist.edd_form_completed)
            errors.push("internal_checklist.edd_form_completed harus true");
        if (officer.cdd_edd_consistency === "NOT_CONSISTENT" && !officer.consistency_notes)
            errors.push("officer_analysis.consistency_notes wajib diisi jika cdd_edd_consistency = NOT_CONSISTENT");
        if (officer.transaction_profile_reasonableness === "NOT_REASONABLE" && !officer.transaction_notes)
            errors.push("officer_analysis.transaction_notes wajib diisi jika transaction_profile_reasonableness = NOT_REASONABLE");
        if (officer.occupation_source_funds_wealth_assessment === "NOT_ADEQUATE" && !officer.source_funds_wealth_notes)
            errors.push("officer_analysis.source_funds_wealth_notes wajib diisi jika occupation_source_funds_wealth_assessment = NOT_ADEQUATE");
        const relPurpose = addInfo.relationship_or_transaction_purpose;
        if (Array.isArray(relPurpose) && relPurpose.includes("OTHER") && !addInfo.relationship_or_transaction_purpose_other)
            errors.push("additional_information.relationship_or_transaction_purpose_other wajib diisi jika OTHER dipilih");
        const srcFunds = addInfo.source_of_funds;
        if (Array.isArray(srcFunds) && srcFunds.includes("OTHER") && !addInfo.source_of_funds_other)
            errors.push("additional_information.source_of_funds_other wajib diisi jika OTHER dipilih");
        const wealth = addInfo.wealth_information;
        if (Array.isArray(wealth) && wealth.includes("OTHER") && !addInfo.wealth_information_other)
            errors.push("additional_information.wealth_information_other wajib diisi jika OTHER dipilih");
        if (errors.length)
            throw new common_1.BadRequestException({ message: "EDD belum memenuhi syarat untuk diselesaikan", errors });
    }
    // ──────────────────────────────────────────────────────────────────────────
    async decide(appId, decision, reason, reviewerId) {
        const { rows } = await this.pool.query(`SELECT id, status FROM applications WHERE id=$1`, [appId]);
        const app = rows[0];
        if (!app)
            throw new common_1.NotFoundException("Application not found");
        if (!["SUBMITTED", "IN_REVIEW"].includes(app.status)) {
            throw new common_1.BadRequestException(`Tidak bisa membuat keputusan untuk status ${app.status}. Harus SUBMITTED atau IN_REVIEW.`);
        }
        if (decision === "APPROVED") {
            // Blokir jika EDD wajib tapi belum selesai (HIGH RISK)
            const { rows: eddRows } = await this.pool.query(`SELECT edd_required, edd_completed FROM application_edd WHERE application_id=$1`, [appId]);
            if (eddRows[0]?.edd_required && !eddRows[0]?.edd_completed) {
                throw new common_1.BadRequestException("Application HIGH RISK wajib memiliki EDD lengkap sebelum disetujui.");
            }
            // Blokir jika ada CONFIRMED DTTOT/PPPSPM
            const { rows: blockers } = await this.pool.query(`SELECT id, list_type FROM screening_results
         WHERE application_id = $1
           AND review_status = 'CONFIRMED'
           AND list_type IN ('DTTOT','PPPSPM')
         LIMIT 1`, [appId]);
            if (blockers.length) {
                throw new common_1.BadRequestException(`Tidak dapat approve: terdapat CONFIRMED ${blockers[0].list_type} hit. Lakukan review manual terlebih dahulu.`);
            }
            // Pastikan risk sudah pernah dihitung; kalau belum, hitung sekarang
            const { rows: riskRows } = await this.pool.query(`SELECT application_id FROM application_risk WHERE application_id=$1`, [appId]);
            if (!riskRows.length) {
                await this.screenAndComputeRisk(appId);
            }
        }
        const res = await this.pool.query(`UPDATE applications
       SET status=$2, decision_by=$3, decision_reason=$4, decision_at=now(), updated_at=now()
       WHERE id=$1
       RETURNING id, status, decision_reason, decision_at`, [appId, decision, reviewerId, reason || null]);
        return res.rows[0];
    }
};
exports.ApplicationsService = ApplicationsService;
exports.ApplicationsService = ApplicationsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)("PG_POOL")),
    __metadata("design:paramtypes", [pg_1.Pool])
], ApplicationsService);
//# sourceMappingURL=applications.service.js.map