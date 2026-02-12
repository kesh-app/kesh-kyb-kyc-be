import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { Pool } from "pg";

/** Ambang & bobot scoring (bisa kamu pindah ke ENV nanti) */
const SIMILARITY_THRESHOLD = 0.35; // minimal dianggap hit
const WEIGHT = {
  PEP: 30, // per hit
  DTTOT: 70, // per hit (sangat tinggi)
  PPPSPM: 50, // per hit
  DOC_MISSING: 10, // penalty per dokumen wajib yang hilang (fallback)
};

/** Ubah angka 0..100 ke level */
function levelOf(score: number) {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

@Injectable()
export class ApplicationsService {
  constructor(@Inject("PG_POOL") private readonly pool: Pool) {}

  // di src/modules/applications/applications.service.ts (dalam class ApplicationsService)

  private async recomputeAutoBump(appId: number, reviewerId?: number) {
    // cek apakah ada CONFIRMED DTTOT/PPPSPM
    const { rows: hits } = await this.pool.query(
      `SELECT list_type
     FROM screening_results
     WHERE application_id = $1
       AND review_status = 'CONFIRMED'
       AND list_type IN ('DTTOT','PPPSPM')
     LIMIT 1`,
      [appId]
    );

    if (hits.length) {
      const lt = hits[0].list_type as "DTTOT" | "PPPSPM";
      const reason = `AUTO_BUMP: CONFIRMED ${lt} hit`;

      // set/overwrite override hanya jika sebelumnya kosong atau juga AUTO_BUMP
      await this.pool.query(
        `INSERT INTO application_risk (application_id, risk_score, risk_level, factors,
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
           THEN now() ELSE application_risk.override_at END`,
        [appId, reason, reviewerId || null]
      );
      return;
    }

    // tidak ada CONFIRMED DTTOT/PPPSPM → bersihkan override kalau itu AUTO_BUMP
    await this.pool.query(
      `UPDATE application_risk
     SET override_level = NULL,
         override_reason = NULL,
         override_by = NULL,
         override_at = NULL
     WHERE application_id=$1
       AND override_reason LIKE 'AUTO_BUMP:%'`,
      [appId]
    );
  }

  // applications.service.ts
  async createIndividual(dto: any, userId: number, branchId?: number) {
    const norm = (s: string) => (s || "").replace(/\D+/g, "").trim(); // buang non-digit untuk KTP
    if (dto.identity_type === "KTP")
      dto.identity_number = norm(dto.identity_number);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1) coba cari person existing (khususnya utk KTP)
      let personId: number | null = null;
      const { rows: found } = await client.query(
        `SELECT id FROM persons WHERE identity_type = $1 AND identity_number = $2 LIMIT 1`,
        [dto.identity_type, dto.identity_number]
      );
      if (found[0]) personId = found[0].id;

      // 2) kalau belum ada, insert person baru
      if (!personId) {
        const ins = await client.query(
          `INSERT INTO persons (full_name, identity_type, identity_number, address_identity, address_residential,
                              pob, dob, nationality, phone, occupation, gender, email, signature_uri)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id`,
          [
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
          ]
        );
        personId = ins.rows[0].id;
      }

      // 3) buat application
      const appRes = await client.query(
        `INSERT INTO applications (type, status, branch_id, created_by, person_id)
       VALUES ('INDIVIDUAL','DRAFT',$1,$2,$3)
       RETURNING id, status`,
        [branchId || null, userId, personId]
      );

      await client.query("COMMIT");
      return appRes.rows[0];
    } catch (e: any) {
      await client.query("ROLLBACK");
      // race condition fallback: jika bentrok unik, ambil person existing lalu lanjut bikin app
      if (e?.code === "23505") {
        const { rows } = await this.pool.query(
          `SELECT id FROM persons WHERE identity_type=$1 AND identity_number=$2 LIMIT 1`,
          [dto.identity_type, dto.identity_number]
        );
        const personId = rows[0]?.id;
        if (personId) {
          const appRes = await this.pool.query(
            `INSERT INTO applications (type, status, branch_id, created_by, person_id)
           VALUES ('INDIVIDUAL','DRAFT',$1,$2,$3)
           RETURNING id, status`,
            [branchId || null, userId, personId]
          );
          return appRes.rows[0];
        }
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async createBusiness(dto: any, userId: number, branchId?: number) {
    const q = await this.pool.query(
      `INSERT INTO business_entities (legal_name, legal_form, incorporation_place, incorporation_date,
        business_license_number, nib, npwp, address_line, city, province, postal_code, business_activity, industry_code, phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
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
      ]
    );
    const businessId = q.rows[0].id;

    const appRes = await this.pool.query(
      `INSERT INTO applications (type, status, branch_id, created_by, business_id)
       VALUES ('BUSINESS','DRAFT',$1,$2,$3)
       RETURNING id, status`,
      [branchId || null, userId, businessId]
    );
    return appRes.rows[0];
  }

  async addDocument(
    appId: number,
    dto: { doc_type: string; file_uri: string; extracted_json?: any }
  ) {
    const { rows: apps } = await this.pool.query(
      `SELECT id FROM applications WHERE id=$1`,
      [appId]
    );
    if (!apps[0]) throw new NotFoundException("Application not found");

    const res = await this.pool.query(
      `INSERT INTO documents (application_id, doc_type, file_uri, status, extracted_json)
       VALUES ($1,$2,$3,'PENDING',$4)
       RETURNING id, application_id, doc_type, file_uri, status, extracted_json, created_at`,
      [appId, dto.doc_type, dto.file_uri, dto.extracted_json || null]
    );
    return res.rows[0];
  }

  async getDetail(appId: number) {
    const { rows: apps } = await this.pool.query(
      `SELECT a.*, p.full_name, p.identity_type, p.identity_number, p.signature_uri,
              b.legal_name, b.nib, b.npwp
       FROM applications a
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       WHERE a.id=$1`,
      [appId]
    );
    const app = apps[0];
    if (!app) throw new NotFoundException("Application not found");

    const { rows: docs } = await this.pool.query(
      `SELECT id, doc_type, file_uri, status, extracted_json, created_at
       FROM documents WHERE application_id=$1 ORDER BY created_at DESC`,
      [appId]
    );

    let parties: any[] = [];
    if (app.business_id) {
      const q = await this.pool.query(
        `SELECT bp.id, bp.role, bp.is_active, p.id as person_id, p.full_name, p.identity_type, p.identity_number
         FROM business_parties bp
         JOIN persons p ON p.id = bp.person_id
         WHERE bp.business_id = $1
         ORDER BY bp.created_at DESC`,
        [app.business_id]
      );
      parties = q.rows;
    }

    return { application: app, documents: docs, parties };
  }

  async validateBeforeSubmit(appId: number) {
    const { rows } = await this.pool.query(
      `SELECT id, type, person_id, business_id FROM applications WHERE id=$1`,
      [appId]
    );
    const app = rows[0];
    if (!app) throw new NotFoundException("Application not found");

    // ambil dokumen
    const { rows: docs } = await this.pool.query(
      `SELECT doc_type FROM documents WHERE application_id=$1`,
      [appId]
    );
    const docSet = new Set(docs.map((d) => d.doc_type));

    if (app.type === "INDIVIDUAL") {
      const { rows: pr } = await this.pool.query(
        `SELECT signature_uri FROM persons WHERE id=$1`,
        [app.person_id]
      );
      const person = pr[0];

      const missing: string[] = [];
      if (!person?.signature_uri) missing.push("signature_uri (tanda tangan)");
      if (!(docSet.has("KTP") || docSet.has("SIM") || docSet.has("PASPOR"))) {
        missing.push("dokumen identitas (KTP/SIM/PASPOR)");
      }

      if (missing.length) {
        throw new BadRequestException({
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
      const { rows: parties } = await this.pool.query(
        `SELECT role FROM business_parties WHERE business_id=$1 AND is_active = TRUE`,
        [app.business_id]
      );
      const roles = new Set(parties.map((p) => p.role));
      const hasPengurus = roles.has("DIRECTOR") || roles.has("COMMISSIONER");
      const hasBO = roles.has("BO");
      const hasAuthRep = roles.has("AUTHORIZED_REP");

      const hasAnyRequiredParty = hasPengurus || hasBO || hasAuthRep;

      const missing: string[] = [];
      if (missingDocs.length)
        missing.push(`dokumen korporasi: ${missingDocs.join(", ")}`);
      if (!hasAnyRequiredParty)
        missing.push(
          "minimal 1 party: (DIRECTOR/COMMISSIONER) atau BO atau AUTHORIZED_REP"
        );

      if (missing.length) {
        throw new BadRequestException({
          message: "BUSINESS belum lengkap untuk submit",
          missing,
        });
      }
      return { ok: true };
    }

    // fallback
    return { ok: true };
  }

  /** Jalankan screening terhadap subject aplikasi + compute risk, simpan ke screening_results & application_risk */
  async screenAndComputeRisk(appId: number) {
    // ambil aplikasi
    const { rows: apps } = await this.pool.query(
      `SELECT id, type, person_id, business_id FROM applications WHERE id=$1`,
      [appId]
    );
    const app = apps[0];
    if (!app) throw new NotFoundException("Application not found");

    // kumpulkan subjek yang akan di-screen:
    type Subject = {
      subject_type: "INDIVIDUAL" | "BUSINESS" | "PARTY";
      name: string;
      dob?: string | null;
      nationality?: string | null;
      ref?: number | null;
      extra?: any;
    };
    const subjects: Subject[] = [];

    if (app.type === "INDIVIDUAL") {
      const { rows: p } = await this.pool.query(
        `SELECT id, full_name AS name, dob::text AS dob, nationality FROM persons WHERE id=$1`,
        [app.person_id]
      );
      if (p[0])
        subjects.push({
          subject_type: "INDIVIDUAL",
          name: p[0].name,
          dob: p[0].dob,
          nationality: p[0].nationality,
          ref: p[0].id,
        });
    } else if (app.type === "BUSINESS") {
      const { rows: b } = await this.pool.query(
        `SELECT id, legal_name AS name, country AS nationality FROM business_entities WHERE id=$1`,
        [app.business_id]
      );
      if (b[0])
        subjects.push({
          subject_type: "BUSINESS",
          name: b[0].name,
          nationality: b[0].nationality || null,
          ref: b[0].id,
        });

      // parties (DIRECTOR/COMMISSIONER/MANAGER/BO/AUTHORIZED_REP)
      const { rows: parties } = await this.pool.query(
        `SELECT bp.id as party_id, bp.role,
              p.id as person_id, p.full_name as name, p.dob::text as dob, p.nationality
       FROM business_parties bp
       JOIN persons p ON p.id = bp.person_id
       WHERE bp.business_id=$1 AND bp.is_active = TRUE`,
        [app.business_id]
      );
      for (const r of parties) {
        subjects.push({
          subject_type: "PARTY",
          name: r.name,
          dob: r.dob,
          nationality: r.nationality,
          ref: r.party_id,
          extra: { role: r.role, person_id: r.person_id },
        });
      }
    }

    // bersihkan hasil screening lama (agar idempotent)
    await this.pool.query(
      `DELETE FROM screening_results WHERE application_id=$1`,
      [appId]
    );

    // jalankan screening per subject terhadap watchlist_entries
    let pepHits = 0,
      dttotHits = 0,
      pppspmHits = 0;

    for (const s of subjects) {
      const { rows: candidates } = await this.pool.query(
        `
      SELECT id, list_type, name, date_of_birth, nationality,
             similarity(name_norm, upper(regexp_replace($1, '\s+', ' ', 'g'))) AS score
      FROM watchlist_entries
      WHERE name_norm % upper(regexp_replace($1, '\s+', ' ', 'g'))
        AND ($2::date IS NULL OR date_of_birth = $2::date)
        AND ($3::text IS NULL OR upper(nationality) = upper($3))
      ORDER BY score DESC
      LIMIT 30
      `,
        [s.name, s.dob || null, s.nationality || null]
      );

      for (const c of candidates) {
        if (Number(c.score) < SIMILARITY_THRESHOLD) continue;

        await this.pool.query(
          `INSERT INTO screening_results (application_id, subject_type, subject_ref, list_type, watchlist_id, matched_name, matched_dob, matched_nationality, score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            appId,
            s.subject_type,
            s.ref || null,
            c.list_type,
            c.id,
            c.name,
            c.date_of_birth || null,
            c.nationality || null,
            c.score,
          ]
        );

        if (c.list_type === "PEP") pepHits++;
        if (c.list_type === "DTTOT") dttotHits++;
        if (c.list_type === "PPPSPM") pppspmHits++;
      }
    }

    // ambil faktor dokumen hilang (fallback) dari precheck untuk penalti ringan
    let docPenalty = 0;
    try {
      await this.validateBeforeSubmit(appId);
    } catch (e: any) {
      const missing: string[] = e?.response?.missing || [];
      docPenalty = missing.length * WEIGHT.DOC_MISSING;
    }

    // hitung risk dasar
    let score = 0;
    score += pepHits * WEIGHT.PEP;
    score += dttotHits * WEIGHT.DTTOT;
    score += pppspmHits * WEIGHT.PPPSPM;
    score += docPenalty;

    // clamp 0..100
    score = Math.max(0, Math.min(100, score));
    const risk_level = levelOf(score);

    const factors = {
      hits: { pep: pepHits, dttot: dttotHits, pppspm: pppspmHits },
      docPenalty,
      threshold: SIMILARITY_THRESHOLD,
      weights: WEIGHT,
    };

    await this.pool.query(
      `INSERT INTO application_risk (application_id, risk_score, risk_level, factors, created_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (application_id) DO UPDATE SET
       risk_score=EXCLUDED.risk_score,
       risk_level=EXCLUDED.risk_level,
       factors=EXCLUDED.factors,
       created_at=now()`,
      [appId, score, risk_level, JSON.stringify(factors)]
    );

    return { risk_score: score, risk_level, factors };
  }

  // List parties for a BUSINESS application
  async listParties(appId: number) {
    // pastikan application-nya BUSINESS
    const { rows: appRows } = await this.pool.query(
      `SELECT id, business_id, type FROM applications WHERE id=$1`,
      [appId]
    );
    const app = appRows[0];
    if (!app) throw new NotFoundException("Application not found");
    if (app.type !== "BUSINESS" || !app.business_id)
      throw new BadRequestException(
        "Parties only apply to BUSINESS applications"
      );

    const { rows } = await this.pool.query(
      `SELECT bp.id, bp.role, bp.is_active, bp.created_at,
            p.id AS person_id, p.full_name, p.identity_type, p.identity_number, p.dob, p.nationality
     FROM business_parties bp
     JOIN persons p ON p.id = bp.person_id
     WHERE bp.business_id = $1
     ORDER BY bp.created_at DESC`,
      [app.business_id]
    );
    return rows;
  }

  // Create / upsert person, then attach into business_parties
  async addParty(appId: number, dto: any) {
    const { rows: appRows } = await this.pool.query(
      `SELECT id, business_id, type FROM applications WHERE id=$1`,
      [appId]
    );
    const app = appRows[0];
    if (!app) throw new NotFoundException("Application not found");
    if (app.type !== "BUSINESS" || !app.business_id)
      throw new BadRequestException(
        "Parties only apply to BUSINESS applications"
      );

    // cari existing person by (identity_type, identity_number)
    const { rows: existing } = await this.pool.query(
      `SELECT id FROM persons WHERE identity_type=$1 AND identity_number=$2 LIMIT 1`,
      [dto.identity_type, dto.identity_number]
    );

    let personId: number;
    if (existing[0]) {
      personId = existing[0].id;
      // optional: update data dasar
      await this.pool.query(
        `UPDATE persons
       SET full_name=COALESCE($1, full_name),
           dob=COALESCE($2::date, dob),
           nationality=COALESCE($3, nationality),
           phone=COALESCE($4, phone),
           email=COALESCE($5, email)
       WHERE id=$6`,
        [
          dto.full_name || null,
          dto.dob || null,
          dto.nationality || null,
          dto.phone || null,
          dto.email || null,
          personId,
        ]
      );
    } else {
      const ins = await this.pool.query(
        `INSERT INTO persons (full_name, identity_type, identity_number, dob, nationality, phone, email)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          dto.full_name,
          dto.identity_type,
          dto.identity_number,
          dto.dob || null,
          dto.nationality || null,
          dto.phone || null,
          dto.email || null,
        ]
      );
      personId = ins.rows[0].id;
    }

    // insert ke business_parties (unique per business/person/role)
    const party = await this.pool.query(
      `INSERT INTO business_parties (business_id, person_id, role, is_active)
     VALUES ($1,$2,$3,TRUE)
     ON CONFLICT (business_id, person_id, role) DO UPDATE SET is_active=TRUE
     RETURNING id, business_id, person_id, role, is_active, created_at`,
      [app.business_id, personId, dto.role]
    );

    return party.rows[0];
  }

  async deleteParty(appId: number, partyId: number) {
    const { rows: appRows } = await this.pool.query(
      `SELECT id, business_id, type FROM applications WHERE id=$1`,
      [appId]
    );
    const app = appRows[0];
    if (!app) throw new NotFoundException("Application not found");
    if (app.type !== "BUSINESS" || !app.business_id)
      throw new BadRequestException(
        "Parties only apply to BUSINESS applications"
      );

    const { rows } = await this.pool.query(
      `DELETE FROM business_parties WHERE id=$1 AND business_id=$2 RETURNING id`,
      [partyId, app.business_id]
    );
    if (!rows[0]) throw new NotFoundException("Party not found");
    return { ok: true };
  }

  async submit(appId: number, reviewerId: number) {
    await this.validateBeforeSubmit(appId);

    const res = await this.pool.query(
      `UPDATE applications
     SET status='SUBMITTED', submitted_at=now(), reviewer_id=$2
     WHERE id=$1
     RETURNING id`,
      [appId, reviewerId]
    );
    if (!res.rows[0]) throw new NotFoundException("Application not found");

    // <<< SCREEN & RISK otomatis setelah submit >>>
    const risk = await this.screenAndComputeRisk(appId);

    return { id: appId, status: "SUBMITTED", risk };
  }

  async list(limit = 20, offset = 0) {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.type, a.status, a.created_at,
              p.full_name as person_name, b.legal_name as business_name
       FROM applications a
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       ORDER BY a.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows;
  }

  async listDocuments(appId: number) {
    const { rows: apps } = await this.pool.query(
      `SELECT id FROM applications WHERE id=$1`,
      [appId]
    );
    if (!apps[0]) throw new NotFoundException("Application not found");

    const { rows } = await this.pool.query(
      `SELECT id, doc_type, file_uri, status, extracted_json, created_at
       FROM documents
       WHERE application_id=$1
       ORDER BY created_at DESC`,
      [appId]
    );
    return rows;
  }

  async getScreening(appId: number) {
    const { rows: results } = await this.pool.query(
      `SELECT id, subject_type, subject_ref, list_type, watchlist_id, matched_name, matched_dob,
            matched_nationality, score, review_status, review_notes, reviewed_by, reviewed_at, created_at
     FROM screening_results
     WHERE application_id=$1
     ORDER BY score DESC, created_at DESC`,
      [appId]
    );
    const { rows: risk } = await this.pool.query(
      `SELECT application_id, risk_score, risk_level, factors,
            override_level, override_reason, override_by, override_at, created_at
     FROM application_risk WHERE application_id=$1`,
      [appId]
    );
    return { results, risk: risk[0] || null };
  }

  async reviewScreeningResult(
    appId: number,
    resultId: number,
    status: "CONFIRMED" | "FALSE_POSITIVE" | "DISMISSED",
    notes: string | null,
    reviewerId: number
  ) {
    const { rows } = await this.pool.query(
      `UPDATE screening_results
     SET review_status=$1, review_notes=$2, reviewed_by=$3, reviewed_at=now()
     WHERE id=$4 AND application_id=$5
     RETURNING id`,
      [status, notes || null, reviewerId, resultId, appId]
    );
    if (!rows[0]) throw new NotFoundException("Screening result not found");

    // ⬇️ cek & terapkan auto-bump (atau bersihkan bila tak perlu)
    await this.recomputeAutoBump(appId, reviewerId);

    return { ok: true };
  }

  async overrideRisk(
    appId: number,
    level: "LOW" | "MEDIUM" | "HIGH",
    reason: string,
    reviewerId: number
  ) {
    const { rows } = await this.pool.query(
      `UPDATE application_risk
     SET override_level=$2, override_reason=$3, override_by=$4, override_at=now()
     WHERE application_id=$1
     RETURNING application_id`,
      [appId, level, reason, reviewerId]
    );
    if (!rows[0]) {
      // kalau belum ada row risk (harusnya ada setelah submit), buat baru minimal
      await this.pool.query(
        `INSERT INTO application_risk (application_id, risk_score, risk_level, factors,
                                     override_level, override_reason, override_by, override_at, created_at)
       VALUES ($1, 0, 'LOW', '{}', $2, $3, $4, now(), now())`,
        [appId, level, reason, reviewerId]
      );
    }
    return { ok: true };
  }

  async listWithRisk(limit = 20, offset = 0) {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.type, a.status, a.created_at, a.submitted_at,
            COALESCE(ar.override_level, ar.risk_level) AS risk_level,
            ar.risk_score,
            CASE WHEN ar.override_level IS NOT NULL THEN true ELSE false END AS risk_overridden
     FROM applications a
     LEFT JOIN application_risk ar ON ar.application_id = a.id
     ORDER BY a.created_at DESC
     LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows;
  }

  async getDocument(appId: number, docId: number) {
    const { rows } = await this.pool.query(
      `SELECT id, application_id, doc_type, file_uri, status, extracted_json
       FROM documents
       WHERE id=$1`,
      [docId]
    );
    const doc = rows[0];
    if (!doc) throw new NotFoundException("Document not found");
    if (doc.application_id !== appId)
      throw new ForbiddenException(
        "Document does not belong to this application"
      );
    return doc;
  }

  async deleteDocument(appId: number, docId: number) {
    const doc = await this.getDocument(appId, docId);
    await this.pool.query(`DELETE FROM documents WHERE id=$1`, [docId]);
    return doc;
  }
}
