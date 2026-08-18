import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "crypto";
import { resolveUserId } from "../../common/auth.util";
import { assertCanMutateKyc } from "../../common/kyc-access";

type AuthedUser = { sub?: number | string; id?: number | string; role: string };
type Db = Pool | PoolClient;

// Status review yang masih boleh diubah FrontDesk. SUBMITTED sengaja TIDAK
// termasuk: begitu diajukan, draft dibekukan sampai Compliance memutuskan.
export const DRAFT_EDITABLE_STATUSES = ["DRAFT", "RETURNED_FOR_REVISION"];

// Role yang boleh menyunting draft. ComplianceLead sengaja TIDAK ada di sini —
// Compliance mereview, tidak mengarang perubahan atas nama Frontline.

/**
 * Kolom yang boleh diusulkan berubah lewat Pengkinian Data. Allow-list, bukan
 * blacklist: endpoint CDD lama menerima `any` sehingga kolom identitas sistem
 * (cif_no, public_id, name_norm) ikut terbuka. Di jalur ini tidak.
 */
export const PERSON_EDITABLE_COLUMNS = [
  "full_name", "alias", "identity_type", "identity_number", "ktp_number",
  "sim_number", "passport_number", "pob", "dob", "nationality", "phone",
  "email", "gender", "occupation", "occupation_other", "industry_category",
  "industry_category_other", "company_name", "company_address",
  "monthly_income_range", "source_of_funds", "source_of_funds_other",
  "business_relationship_purpose", "business_relationship_purpose_other",
  "distribution_channel", "wic_transaction_purpose",
  "wic_transaction_purpose_other", "wic_recipient_relationship",
  "wic_recipient_relationship_other", "address_identity", "address_residential",
  "province_code", "province_name", "city_code", "city_name", "district_code",
  "district_name", "village_code", "village_name", "street_address",
  "house_number", "rt_rw", "apartment_block", "address_landmark",
  "signature_uri", "pep_self_declared",
];

export const BUSINESS_EDITABLE_COLUMNS = [
  "legal_name", "trade_name", "nib", "npwp", "legal_form", "legal_form_other",
  "business_license_number", "business_activity", "business_activity_other",
  "incorporation_date", "country", "phone", "company_email", "pic_name",
  "pic_position", "pic_identity_number", "pic_identity_type",
  "representative_signature_name", "verification_officer", "supervisor",
  "source_of_funds", "source_of_funds_other", "business_relationship_purpose",
  "business_relationship_purpose_other", "distribution_channel",
  "business_province_code", "business_province_name", "business_city_code",
  "business_city_name", "business_district_code", "business_district_name",
  "business_village_code", "business_village_name",
  "director_share_percentage", "commissioner_share_percentage",
  "deed_establishment_number", "deed_latest_amendment_number", "address_line",
];

export const PARTY_EDITABLE_COLUMNS = [
  "role", "full_name", "identity_type", "identity_number", "dob", "pob",
  "nationality", "phone", "email", "address", "ownership_percentage",
  "identity_document_type", "source_of_funds", "source_of_funds_other",
  "source_of_wealth", "source_of_wealth_other", "cif_relationship_type",
];

// Bagian EDD yang boleh diusulkan Frontline (sama seperti pembagian section di
// saveEdd: Frontline I–IV, Compliance V–VII). Pengkinian Data adalah alur
// Frontline, jadi hanya I–IV yang bisa di-stage.
export const EDD_EDITABLE_SECTIONS = [
  "applicant_snapshot", "high_risk_reasons", "additional_information",
  "beneficial_owner",
];

/** Nilai dari pg (Date, numeric string, bigint string) → bentuk JSON stabil. */
function normalizeValue(v: any): any {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return String(v);
  return v;
}

/** Perbandingan longgar: NULL/"" dianggap sama, angka "10.00" == 10. */
export function sameValue(a: any, b: any): boolean {
  const na = a === undefined || a === "" ? null : a;
  const nb = b === undefined || b === "" ? null : b;
  if (na === null && nb === null) return true;
  if (na === null || nb === null) return false;
  if (typeof na === "object" || typeof nb === "object") {
    return JSON.stringify(na) === JSON.stringify(nb);
  }
  const fa = Number(na);
  const fb = Number(nb);
  if (!Number.isNaN(fa) && !Number.isNaN(fb) && String(na).trim() !== "" && String(nb).trim() !== "") {
    return fa === fb;
  }
  return String(na) === String(nb);
}

@Injectable()
export class DataReviewDraftsService {
  constructor(@Inject("PG_POOL") private readonly pool: Pool) {}

  // ---------------------------------------------------------------------------
  // Pemuatan & guard
  // ---------------------------------------------------------------------------
  async loadReview(reviewId: number, db: Db = this.pool, forUpdate = false) {
    const { rows } = await db.query(
      `SELECT r.*, a.id AS application_id, a.type AS application_type,
              a.status AS application_status, a.person_id, a.business_id
         FROM application_data_reviews r
         JOIN applications a ON a.id = r.application_id
        WHERE r.id = $1
        ${forUpdate ? "FOR UPDATE OF r" : ""}`,
      [reviewId],
    );
    if (!rows[0]) throw new NotFoundException("Data review not found");
    return rows[0];
  }

  /** FrontDesk boleh edit hanya saat DRAFT/RETURNED_FOR_REVISION. */
  private assertDraftEditable(review: any, user: AuthedUser) {
    assertCanMutateKyc(user.role, "dataReviewDraft");
    if (!DRAFT_EDITABLE_STATUSES.includes(review.status)) {
      throw new BadRequestException(
        `Draft pengkinian data tidak dapat diubah saat status ${review.status}.`,
      );
    }
  }

  /**
   * Konkurensi optimistis. Klien mengirim versi yang terakhir ia baca; kalau
   * draft sudah bergerak (FrontDesk lain menyimpan duluan) → 409, bukan timpa.
   */
  private assertVersion(review: any, expected?: number | null) {
    if (expected === undefined || expected === null) return;
    if (Number(expected) !== Number(review.version)) {
      throw new ConflictException({
        code: "DATA_REVIEW_VERSION_CHANGED",
        message:
          "Draft pengkinian data sudah diperbarui pengguna lain. Muat ulang sebelum melanjutkan.",
        current_version: Number(review.version),
      });
    }
  }

  /** Preflight for multipart uploads, before bytes are written to storage. */
  async assertCanEdit(reviewId: number, user: AuthedUser, expectedVersion?: number | null) {
    const review = await this.loadReview(reviewId);
    this.assertDraftEditable(review, user);
    this.assertVersion(review, expectedVersion);
    return review;
  }

  /** Serialize and atomically commit one draft mutation for a review. */
  private async withDraftTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Baseline digest — deteksi data live berubah di luar review ini
  // ---------------------------------------------------------------------------
  /**
   * persons/business_entities/documents tidak punya updated_at, jadi tidak ada
   * nomor revisi per baris yang bisa dipakai. Digest isi adalah sinyal terkuat
   * yang tersedia tanpa mengubah tabel inti KYC.
   */
  async computeBaselineDigest(appId: number, db: Db = this.pool): Promise<string> {
    const { rows: appRows } = await db.query(
      `SELECT type, person_id, business_id FROM applications WHERE id=$1`,
      [appId],
    );
    const app = appRows[0];
    if (!app) throw new NotFoundException("Application not found");

    const parts: any = {};

    if (app.person_id) {
      const { rows } = await db.query(
        `SELECT ${PERSON_EDITABLE_COLUMNS.join(",")} FROM persons WHERE id=$1`,
        [app.person_id],
      );
      parts.person = rows[0] ?? null;
    }
    if (app.business_id) {
      const { rows } = await db.query(
        `SELECT ${BUSINESS_EDITABLE_COLUMNS.join(",")} FROM business_entities WHERE id=$1`,
        [app.business_id],
      );
      parts.business = rows[0] ?? null;

      const { rows: parties } = await db.query(
        `SELECT bp.id, bp.person_id, bp.role, bp.is_active,
                bp.ownership_percentage, bp.address, bp.identity_document_type,
                bp.source_of_funds, bp.source_of_funds_other,
                bp.source_of_wealth, bp.source_of_wealth_other,
                bp.cif_relationship_type,
                p.full_name, p.identity_type, p.identity_number, p.dob, p.pob,
                p.nationality, p.phone, p.email
           FROM business_parties bp
           JOIN persons p ON p.id = bp.person_id
          WHERE bp.business_id=$1
          ORDER BY bp.id`,
        [app.business_id],
      );
      parts.parties = parties;
    }

    const { rows: docs } = await db.query(
      `SELECT id, doc_type, file_uri, status FROM documents WHERE application_id=$1 ORDER BY id`,
      [appId],
    );
    parts.documents = docs;

    const { rows: edd } = await db.query(
      `SELECT ${EDD_EDITABLE_SECTIONS.join(",")} FROM application_edd WHERE application_id=$1`,
      [appId],
    );
    parts.edd = edd[0] ?? null;

    const canonical = JSON.stringify(parts, (_k, v) => normalizeValue(v));
    return createHash("sha256").update(canonical).digest("hex");
  }

  /** Dipanggil saat promosi: live berubah di luar review → tolak, jangan merge. */
  async assertBaselineUnchanged(review: any, db: Db = this.pool) {
    if (!review.baseline_digest) return; // review V1 yang baru naik kelas
    const current = await this.computeBaselineDigest(Number(review.application_id), db);
    if (current !== review.baseline_digest) {
      throw new ConflictException({
        code: "DATA_REVIEW_BASELINE_CHANGED",
        message:
          "Data pengguna jasa berubah di luar pengkinian ini sejak draft dibuat. " +
          "Perubahan tidak dapat dipromosikan otomatis — tinjau ulang draft.",
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Kompatibilitas review lama (V1 → V2)
  // ---------------------------------------------------------------------------
  /**
   * Review yang dibuat sebelum arsitektur ini tidak punya baseline maupun
   * change-set. Saat FrontDesk mulai memakai endpoint draft baru, review naik
   * kelas ke V2 dan baseline diambil SAAT ITU — bukan dikarang mundur.
   */
  private async ensureV2(review: any, db: Db = this.pool) {
    if (review.changes_model === "V2" && review.baseline_digest) return review;
    const digest = await this.computeBaselineDigest(Number(review.application_id), db);
    const { rows } = await db.query(
      `UPDATE application_data_reviews
          SET changes_model='V2',
              baseline_digest=$2,
              baseline_captured_at=COALESCE(baseline_captured_at, now()),
              updated_at=now()
        WHERE id=$1
        RETURNING *`,
      [review.id, digest],
    );
    return { ...review, ...rows[0] };
  }

  // ---------------------------------------------------------------------------
  // Primitif change-set
  // ---------------------------------------------------------------------------
  /** Usulan aktif (belum digantikan) untuk satu review. */
  async activeChanges(reviewId: number, db: Db = this.pool) {
    const { rows } = await db.query(
      `SELECT c.*, COALESCE(u.name, u.email) AS created_by_name
         FROM application_data_review_changes c
         LEFT JOIN users u ON u.id = c.created_by
        WHERE c.review_id = $1 AND c.superseded_at IS NULL
        ORDER BY c.id`,
      [reviewId],
    );
    return rows;
  }

  private async findActiveChange(
    reviewId: number,
    entityType: string,
    targetId: number | null,
    db: Db = this.pool,
  ) {
    const { rows } = await db.query(
      `SELECT * FROM application_data_review_changes
        WHERE review_id=$1 AND entity_type=$2 AND superseded_at IS NULL
          AND target_id IS NOT DISTINCT FROM $3
        ORDER BY id DESC LIMIT 1`,
      [reviewId, entityType, targetId],
    );
    return rows[0] ?? null;
  }

  private async supersede(changeId: number, db: Db = this.pool) {
    await db.query(
      `UPDATE application_data_review_changes
          SET superseded_at=now(), updated_at=now() WHERE id=$1`,
      [changeId],
    );
  }

  private async insertChange(
    db: Db,
    row: {
      reviewId: number;
      entityType: string;
      targetId: number | null;
      operation: string;
      beforeData: any;
      afterData: any;
      stagedObjectKey?: string | null;
      createdBy: number | string;
    },
  ) {
    const { rows } = await db.query(
      `INSERT INTO application_data_review_changes
         (review_id, entity_type, target_id, operation, before_data, after_data,
          staged_object_key, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)
       RETURNING *`,
      [
        row.reviewId,
        row.entityType,
        row.targetId,
        row.operation,
        row.beforeData === null ? null : JSON.stringify(row.beforeData),
        row.afterData === null ? null : JSON.stringify(row.afterData),
        row.stagedObjectKey ?? null,
        row.createdBy,
      ],
    );
    return rows[0];
  }

  /** Setiap mutasi draft menaikkan versi — dasar pengecekan approval basi. */
  private async bumpVersion(reviewId: number, db: Db = this.pool): Promise<number> {
    const { rows } = await db.query(
      `UPDATE application_data_reviews
          SET version = version + 1, updated_at = now()
        WHERE id=$1 RETURNING version`,
      [reviewId],
    );
    return Number(rows[0].version);
  }

  // ---------------------------------------------------------------------------
  // Staging: PERSON / BUSINESS (scalar)
  // ---------------------------------------------------------------------------
  private async stageScalar(
    reviewId: number,
    user: AuthedUser,
    patch: Record<string, any>,
    opts: { entityType: "PERSON" | "BUSINESS"; expectedVersion?: number },
    db?: PoolClient,
  ): Promise<any> {
    if (!db) {
      return this.withDraftTransaction((client) =>
        this.stageScalar(reviewId, user, patch, opts, client),
      );
    }

    let review = await this.loadReview(reviewId, db, true);
    this.assertDraftEditable(review, user);
    this.assertVersion(review, opts.expectedVersion);
    review = await this.ensureV2(review, db);

    const isPerson = opts.entityType === "PERSON";
    const table = isPerson ? "persons" : "business_entities";
    const targetId = isPerson ? review.person_id : review.business_id;
    const allowed = isPerson ? PERSON_EDITABLE_COLUMNS : BUSINESS_EDITABLE_COLUMNS;

    if (!targetId) {
      throw new BadRequestException(
        isPerson
          ? "Aplikasi ini bukan tipe Individual."
          : "Aplikasi ini bukan tipe Business.",
      );
    }

    const unknown = Object.keys(patch).filter((k) => !allowed.includes(k));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Field tidak dapat diubah lewat pengkinian data: ${unknown.join(", ")}`,
      );
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException("Tidak ada field yang dikirim.");
    }

    const { rows: liveRows } = await db.query(
      `SELECT ${allowed.join(",")} FROM ${table} WHERE id=$1`,
      [targetId],
    );
    const live = liveRows[0];
    if (!live) throw new NotFoundException(`${table} row not found`);

    const existing = await this.findActiveChange(
      reviewId,
      opts.entityType,
      Number(targetId),
      db,
    );

    // before_data = nilai live untuk SEMUA field yang pernah disentuh siklus ini.
    // after_data  = akumulasi usulan; patch kedua tidak menghapus patch pertama.
    const before: Record<string, any> = { ...(existing?.before_data ?? {}) };
    const after: Record<string, any> = { ...(existing?.after_data ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in before)) before[k] = normalizeValue(live[k]);
      after[k] = v === undefined ? null : v;
    }

    // Field yang kembali sama dengan live bukan perubahan — buang dari usulan
    // supaya tidak terhitung sebagai "ada perubahan" saat submit.
    for (const k of Object.keys(after)) {
      if (sameValue(after[k], before[k])) {
        delete after[k];
        delete before[k];
      }
    }

    if (existing) await this.supersede(existing.id, db);

    let change: any = null;
    if (Object.keys(after).length > 0) {
      change = await this.insertChange(db, {
        reviewId,
        entityType: opts.entityType,
        targetId: Number(targetId),
        operation: "UPDATE",
        beforeData: before,
        afterData: after,
        createdBy: resolveUserId(user),
      });
    }

    const version = await this.bumpVersion(reviewId, db);
    return { change, version };
  }

  stagePerson(reviewId: number, user: AuthedUser, patch: Record<string, any>, expectedVersion?: number) {
    return this.stageScalar(reviewId, user, patch, { entityType: "PERSON", expectedVersion });
  }

  stageBusiness(reviewId: number, user: AuthedUser, patch: Record<string, any>, expectedVersion?: number) {
    return this.stageScalar(reviewId, user, patch, { entityType: "BUSINESS", expectedVersion });
  }

  // ---------------------------------------------------------------------------
  // Staging: PARTY (ADD / UPDATE / DELETE)
  // ---------------------------------------------------------------------------
  async stageParty(
    reviewId: number,
    user: AuthedUser,
    body: { operation: string; target_id?: number | null; data?: Record<string, any>; expected_version?: number },
    db?: PoolClient,
  ): Promise<any> {
    if (!db) {
      return this.withDraftTransaction((client) =>
        this.stageParty(reviewId, user, body, client),
      );
    }

    let review = await this.loadReview(reviewId, db, true);
    this.assertDraftEditable(review, user);
    this.assertVersion(review, body.expected_version);
    review = await this.ensureV2(review, db);

    if (!review.business_id) {
      throw new BadRequestException("Party hanya berlaku untuk aplikasi Business.");
    }
    const op = String(body.operation || "").toUpperCase();
    if (!["ADD", "UPDATE", "DELETE"].includes(op)) {
      throw new BadRequestException("operation harus ADD, UPDATE, atau DELETE.");
    }

    const data = body.data ?? {};
    const unknown = Object.keys(data).filter((k) => !PARTY_EDITABLE_COLUMNS.includes(k));
    if (unknown.length > 0) {
      throw new BadRequestException(`Field party tidak dikenal: ${unknown.join(", ")}`);
    }

    // ── ADD: baris usulan berdiri sendiri, target_id NULL (belum ada di live)
    if (op === "ADD") {
      if (!data.role || !data.full_name) {
        throw new BadRequestException("role dan full_name wajib diisi untuk party baru.");
      }
      const change = await this.insertChange(db, {
        reviewId,
        entityType: "PARTY",
        targetId: null,
        operation: "ADD",
        beforeData: null,
        afterData: data,
        createdBy: resolveUserId(user),
      });
      const version = await this.bumpVersion(reviewId, db);
      return { change, version };
    }

    // ── UPDATE / DELETE: butuh sasaran. Bisa party live, bisa party hasil ADD
    // yang masih berupa usulan (dibatalkan dengan menghapus usulannya).
    const targetId = body.target_id != null ? Number(body.target_id) : null;
    if (!targetId) {
      throw new BadRequestException("target_id wajib untuk UPDATE/DELETE party.");
    }

    // Membatalkan party yang baru diusulkan siklus ini: cukup supersede
    // usulan ADD-nya. Net nol, tidak menyentuh live sama sekali.
    const stagedAdd = await db.query(
      `SELECT * FROM application_data_review_changes
        WHERE review_id=$1 AND entity_type='PARTY' AND operation='ADD'
          AND id=$2 AND superseded_at IS NULL`,
      [reviewId, targetId],
    );
    if (stagedAdd.rows[0]) {
      if (op === "DELETE") {
        await this.supersede(stagedAdd.rows[0].id, db);
        const version = await this.bumpVersion(reviewId, db);
        return { change: null, version };
      }
      const merged = { ...(stagedAdd.rows[0].after_data ?? {}), ...data };
      await this.supersede(stagedAdd.rows[0].id, db);
      const change = await this.insertChange(db, {
        reviewId,
        entityType: "PARTY",
        targetId: null,
        operation: "ADD",
        beforeData: null,
        afterData: merged,
        createdBy: resolveUserId(user),
      });
      const version = await this.bumpVersion(reviewId, db);
      return { change, version };
    }

    const { rows: liveRows } = await db.query(
      `SELECT bp.id, bp.role, bp.is_active, bp.ownership_percentage, bp.address,
              bp.identity_document_type, bp.source_of_funds, bp.source_of_funds_other,
              bp.source_of_wealth, bp.source_of_wealth_other, bp.cif_relationship_type,
              p.full_name, p.identity_type, p.identity_number, p.dob, p.pob,
              p.nationality, p.phone, p.email
         FROM business_parties bp
         JOIN persons p ON p.id = bp.person_id
        WHERE bp.id=$1 AND bp.business_id=$2`,
      [targetId, review.business_id],
    );
    const live = liveRows[0];
    if (!live) throw new NotFoundException("Party not found for this application");

    const existing = await this.findActiveChange(reviewId, "PARTY", targetId, db);

    if (op === "DELETE") {
      if (existing) await this.supersede(existing.id, db);
      const beforeSnapshot: Record<string, any> = {};
      for (const k of PARTY_EDITABLE_COLUMNS) beforeSnapshot[k] = normalizeValue(live[k]);
      const change = await this.insertChange(db, {
        reviewId,
        entityType: "PARTY",
        targetId,
        operation: "DELETE",
        beforeData: beforeSnapshot,
        afterData: null,
        createdBy: resolveUserId(user),
      });
      const version = await this.bumpVersion(reviewId, db);
      return { change, version };
    }

    // UPDATE — akumulasi seperti scalar.
    const before: Record<string, any> = { ...(existing?.before_data ?? {}) };
    const after: Record<string, any> = { ...(existing?.after_data ?? {}) };
    for (const [k, v] of Object.entries(data)) {
      if (!(k in before)) before[k] = normalizeValue(live[k]);
      after[k] = v === undefined ? null : v;
    }
    for (const k of Object.keys(after)) {
      if (sameValue(after[k], before[k])) {
        delete after[k];
        delete before[k];
      }
    }

    if (existing) await this.supersede(existing.id, db);
    let change: any = null;
    if (Object.keys(after).length > 0) {
      change = await this.insertChange(db, {
        reviewId,
        entityType: "PARTY",
        targetId,
        operation: "UPDATE",
        beforeData: before,
        afterData: after,
        createdBy: resolveUserId(user),
      });
    }
    const version = await this.bumpVersion(reviewId, db);
    return { change, version };
  }

  // ---------------------------------------------------------------------------
  // Staging: EDD
  // ---------------------------------------------------------------------------
  async stageEdd(
    reviewId: number,
    user: AuthedUser,
    body: Record<string, any>,
    expectedVersion?: number,
    db?: PoolClient,
  ): Promise<any> {
    if (!db) {
      return this.withDraftTransaction((client) =>
        this.stageEdd(reviewId, user, body, expectedVersion, client),
      );
    }

    let review = await this.loadReview(reviewId, db, true);
    this.assertDraftEditable(review, user);
    this.assertVersion(review, expectedVersion);
    review = await this.ensureV2(review, db);

    const patch: Record<string, any> = {};
    for (const [k, v] of Object.entries(body)) {
      if (k === "expected_version") continue;
      if (!EDD_EDITABLE_SECTIONS.includes(k)) {
        throw new BadRequestException(
          `Bagian EDD "${k}" tidak dapat diubah lewat pengkinian data (Frontline hanya bagian I–IV).`,
        );
      }
      patch[k] = v;
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException("Tidak ada bagian EDD yang dikirim.");
    }

    const { rows: liveRows } = await db.query(
      `SELECT id, ${EDD_EDITABLE_SECTIONS.join(",")}
         FROM application_edd WHERE application_id=$1`,
      [review.application_id],
    );
    const live = liveRows[0] ?? null;
    const targetId = live ? Number(live.id) : null;

    const existing = await this.findActiveChange(reviewId, "EDD", targetId, db);
    const before: Record<string, any> = { ...(existing?.before_data ?? {}) };
    const after: Record<string, any> = { ...(existing?.after_data ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in before)) before[k] = live ? normalizeValue(live[k]) : {};
      after[k] = v;
    }
    for (const k of Object.keys(after)) {
      if (sameValue(after[k], before[k])) {
        delete after[k];
        delete before[k];
      }
    }

    if (existing) await this.supersede(existing.id, db);
    let change: any = null;
    if (Object.keys(after).length > 0) {
      change = await this.insertChange(db, {
        reviewId,
        entityType: "EDD",
        targetId,
        operation: live ? "UPDATE" : "ADD",
        beforeData: before,
        afterData: after,
        createdBy: resolveUserId(user),
      });
    }
    const version = await this.bumpVersion(reviewId, db);
    return { change, version };
  }

  // ---------------------------------------------------------------------------
  // Staging: DOCUMENT (ADD / REPLACE / DELETE)
  // ---------------------------------------------------------------------------
  /** Prefix staging — objek di sini belum pernah dirujuk baris `documents`. */
  stagingObjectKey(reviewId: number, docType: string, ext: string) {
    const safeType = String(docType || "DOC").replace(/[^A-Za-z0-9_-]/g, "_");
    return `_staging/data-review/${reviewId}/${safeType}-${randomUUID()}${ext}`;
  }

  async stageDocument(
    reviewId: number,
    user: AuthedUser,
    body: {
      operation: string;
      doc_type?: string;
      file_uri?: string;
      target_id?: number | null;
      staged_object_key?: string | null;
      expected_version?: number;
    },
    db?: PoolClient,
  ): Promise<any> {
    if (!db) {
      return this.withDraftTransaction((client) =>
        this.stageDocument(reviewId, user, body, client),
      );
    }

    let review = await this.loadReview(reviewId, db, true);
    this.assertDraftEditable(review, user);
    this.assertVersion(review, body.expected_version);
    review = await this.ensureV2(review, db);

    const op = String(body.operation || "").toUpperCase();
    if (!["ADD", "REPLACE", "DELETE"].includes(op)) {
      throw new BadRequestException("operation harus ADD, REPLACE, atau DELETE.");
    }
    const appId = Number(review.application_id);

    // Membatalkan dokumen yang baru diusulkan siklus ini.
    if (op === "DELETE" && body.target_id) {
      const stagedAdd = await db.query(
        `SELECT * FROM application_data_review_changes
          WHERE review_id=$1 AND entity_type='DOCUMENT' AND operation IN ('ADD','REPLACE')
            AND id=$2 AND superseded_at IS NULL`,
        [reviewId, body.target_id],
      );
      if (stagedAdd.rows[0]) {
        await this.supersede(stagedAdd.rows[0].id, db);
        const version = await this.bumpVersion(reviewId, db);
        return { change: null, version };
      }
    }

    if (op === "DELETE" || op === "REPLACE") {
      if (!body.target_id) {
        throw new BadRequestException("target_id wajib untuk REPLACE/DELETE dokumen.");
      }
      const { rows } = await db.query(
        `SELECT id, doc_type, file_uri, status FROM documents
          WHERE id=$1 AND application_id=$2`,
        [body.target_id, appId],
      );
      if (!rows[0]) throw new NotFoundException("Dokumen tidak ditemukan pada aplikasi ini.");

      const before = {
        id: Number(rows[0].id),
        doc_type: rows[0].doc_type,
        file_uri: rows[0].file_uri,
        status: rows[0].status,
      };

      const existing = await this.findActiveChange(
        reviewId,
        "DOCUMENT",
        Number(body.target_id),
        db,
      );
      if (existing) await this.supersede(existing.id, db);

      const change = await this.insertChange(db, {
        reviewId,
        entityType: "DOCUMENT",
        targetId: Number(body.target_id),
        operation: op,
        beforeData: before,
        afterData:
          op === "DELETE"
            ? null
            : { doc_type: body.doc_type ?? before.doc_type, file_uri: body.file_uri ?? null },
        stagedObjectKey: op === "REPLACE" ? body.staged_object_key ?? null : null,
        createdBy: resolveUserId(user),
      });
      const version = await this.bumpVersion(reviewId, db);
      return { change, version };
    }

    // ADD
    if (!body.doc_type) throw new BadRequestException("doc_type wajib diisi.");
    const change = await this.insertChange(db, {
      reviewId,
      entityType: "DOCUMENT",
      targetId: null,
      operation: "ADD",
      beforeData: null,
      afterData: { doc_type: body.doc_type, file_uri: body.file_uri ?? null },
      stagedObjectKey: body.staged_object_key ?? null,
      createdBy: resolveUserId(user),
    });
    const version = await this.bumpVersion(reviewId, db);
    return { change, version };
  }

  // ---------------------------------------------------------------------------
  // Membatalkan satu usulan
  // ---------------------------------------------------------------------------
  async discardChange(
    reviewId: number,
    changeId: number,
    user: AuthedUser,
    db?: PoolClient,
  ): Promise<any> {
    if (!db) {
      return this.withDraftTransaction((client) =>
        this.discardChange(reviewId, changeId, user, client),
      );
    }

    const review = await this.loadReview(reviewId, db, true);
    this.assertDraftEditable(review, user);

    const { rows } = await db.query(
      `SELECT * FROM application_data_review_changes
        WHERE id=$1 AND review_id=$2 AND superseded_at IS NULL`,
      [changeId, reviewId],
    );
    if (!rows[0]) throw new NotFoundException("Usulan perubahan tidak ditemukan.");
    await this.supersede(changeId, db);
    const version = await this.bumpVersion(reviewId, db);
    return { discarded: true, version };
  }

  // ---------------------------------------------------------------------------
  // Perubahan efektif (untuk guard submit kosong)
  // ---------------------------------------------------------------------------
  /**
   * ADD yang sudah di-supersede, UPDATE yang nilainya balik sama dengan live —
   * keduanya sudah dibuang saat staging, jadi baris aktif yang tersisa memang
   * perubahan nyata. Fungsi ini tinggal menghitungnya.
   */
  async effectiveChanges(reviewId: number, db: Db = this.pool) {
    const rows = await this.activeChanges(reviewId, db);
    return rows.filter((r: any) => {
      if (r.operation === "DELETE") return true;
      const after = r.after_data ?? {};
      return Object.keys(after).length > 0;
    });
  }

  // ---------------------------------------------------------------------------
  // Draft read model — live + usulan
  // ---------------------------------------------------------------------------
  async getDraft(reviewId: number) {
    const review = await this.loadReview(reviewId);
    const appId = Number(review.application_id);
    const changes = await this.activeChanges(reviewId);

    const byType = (t: string) => changes.filter((c: any) => c.entity_type === t);

    // ── current (live) ──
    const current: any = { person: null, business: null, parties: [], documents: [], edd: null };
    if (review.person_id) {
      const { rows } = await this.pool.query(
        `SELECT id, ${PERSON_EDITABLE_COLUMNS.join(",")}, cif_no FROM persons WHERE id=$1`,
        [review.person_id],
      );
      current.person = rows[0] ?? null;
    }
    if (review.business_id) {
      const { rows } = await this.pool.query(
        `SELECT id, ${BUSINESS_EDITABLE_COLUMNS.join(",")}, cif_no FROM business_entities WHERE id=$1`,
        [review.business_id],
      );
      current.business = rows[0] ?? null;

      const { rows: parties } = await this.pool.query(
        `SELECT bp.id, bp.role, bp.is_active, bp.ownership_percentage, bp.address,
                bp.identity_document_type, bp.source_of_funds, bp.source_of_funds_other,
                bp.source_of_wealth, bp.source_of_wealth_other, bp.cif_relationship_type,
                bp.cif_no, p.full_name, p.identity_type, p.identity_number, p.dob,
                p.pob, p.nationality, p.phone, p.email
           FROM business_parties bp
           JOIN persons p ON p.id = bp.person_id
          WHERE bp.business_id=$1 AND bp.is_active = TRUE
          ORDER BY bp.id`,
        [review.business_id],
      );
      current.parties = parties;
    }
    const { rows: docs } = await this.pool.query(
      `SELECT id, doc_type, file_uri, status, created_at
         FROM documents WHERE application_id=$1 ORDER BY id`,
      [appId],
    );
    current.documents = docs;
    const { rows: eddRows } = await this.pool.query(
      `SELECT id, ${EDD_EDITABLE_SECTIONS.join(",")}, edd_required, edd_completed
         FROM application_edd WHERE application_id=$1`,
      [appId],
    );
    current.edd = eddRows[0] ?? null;

    // ── proposed = live + usulan ──
    const proposed: any = {
      person: current.person ? { ...current.person } : null,
      business: current.business ? { ...current.business } : null,
      parties: current.parties.map((p: any) => ({ ...p, _draft_state: null })),
      documents: current.documents.map((d: any) => ({ ...d, _draft_state: null })),
      edd: current.edd ? { ...current.edd } : null,
    };

    for (const c of byType("PERSON")) {
      if (proposed.person) Object.assign(proposed.person, c.after_data ?? {});
    }
    for (const c of byType("BUSINESS")) {
      if (proposed.business) Object.assign(proposed.business, c.after_data ?? {});
    }
    for (const c of byType("EDD")) {
      proposed.edd = { ...(proposed.edd ?? {}), ...(c.after_data ?? {}) };
    }

    for (const c of byType("PARTY")) {
      if (c.operation === "ADD") {
        proposed.parties.push({
          id: null,
          draft_change_id: Number(c.id),
          ...(c.after_data ?? {}),
          _draft_state: "ADDED",
        });
      } else if (c.operation === "DELETE") {
        const idx = proposed.parties.findIndex((p: any) => String(p.id) === String(c.target_id));
        if (idx >= 0) proposed.parties[idx] = { ...proposed.parties[idx], _draft_state: "DELETED" };
      } else {
        const idx = proposed.parties.findIndex((p: any) => String(p.id) === String(c.target_id));
        if (idx >= 0) {
          proposed.parties[idx] = {
            ...proposed.parties[idx],
            ...(c.after_data ?? {}),
            draft_change_id: Number(c.id),
            _draft_state: "UPDATED",
          };
        }
      }
    }

    for (const c of byType("DOCUMENT")) {
      if (c.operation === "ADD") {
        proposed.documents.push({
          id: null,
          draft_change_id: Number(c.id),
          ...(c.after_data ?? {}),
          _draft_state: "ADDED",
        });
      } else if (c.operation === "DELETE") {
        const idx = proposed.documents.findIndex((d: any) => String(d.id) === String(c.target_id));
        if (idx >= 0) proposed.documents[idx] = { ...proposed.documents[idx], _draft_state: "DELETED" };
      } else if (c.operation === "REPLACE") {
        const idx = proposed.documents.findIndex((d: any) => String(d.id) === String(c.target_id));
        if (idx >= 0) {
          proposed.documents[idx] = {
            ...proposed.documents[idx],
            ...(c.after_data ?? {}),
            draft_change_id: Number(c.id),
            _draft_state: "REPLACED",
          };
        }
      }
    }

    // Draft yang ditampilkan ke Frontline menyembunyikan baris yang diusulkan
    // dihapus? Tidak — ditandai saja, supaya bisa dibatalkan dari UI.
    const effective = await this.effectiveChanges(reviewId);

    return {
      review: {
        id: Number(review.id),
        public_id: review.public_id,
        review_no: review.review_no,
        status: review.status,
        review_type: review.review_type,
        version: Number(review.version),
        submitted_version: review.submitted_version != null ? Number(review.submitted_version) : null,
        changes_model: review.changes_model,
        application_id: appId,
        application_status: review.application_status,
        application_type: review.application_type,
        initiated_at: review.initiated_at,
        submitted_at: review.submitted_at,
        reviewed_at: review.reviewed_at,
        approved_at: review.approved_at,
        decision_notes: review.decision_notes,
        editable: DRAFT_EDITABLE_STATUSES.includes(review.status),
        has_pending_changes: effective.length > 0,
      },
      current,
      proposed,
      changes: changes.map((c: any) => this.presentChange(c)),
    };
  }

  // ---------------------------------------------------------------------------
  // PROMOSI — satu-satunya titik data live berubah
  // ---------------------------------------------------------------------------
  /**
   * Key final dokumen hasil promosi. Deterministik per (review, change) supaya
   * percobaan promosi ulang menyalin ke key yang SAMA, bukan membuat dokumen
   * kembar. Mengikuti konvensi key yang sudah dipakai modul uploads.
   */
  finalDocumentKey(appId: number, reviewId: number, changeId: number, stagedKey: string) {
    const ext = stagedKey.includes(".") ? stagedKey.slice(stagedKey.lastIndexOf(".")) : "";
    return `kyc/kyb/${appId}/data-review/${reviewId}/${changeId}${ext}`;
  }

  /**
   * Terapkan seluruh change-set ke tabel live dalam SATU transaksi.
   *
   * Objek storage disalin SEBELUM transaksi dibuka (storage dan Postgres tidak
   * transaksional bersama). Kalau salinan gagal → abort sebelum ada perubahan
   * DB sama sekali. Kalau DB gagal setelah salinan → objek hasil salin jadi
   * yatim tapi tidak pernah dirujuk baris `documents` mana pun, dan karena key
   * tujuan deterministik, retry menyalin ke tempat yang sama (tidak menggandakan).
   *
   * Objek staging TIDAK dihapus di sini — pembersihan hanya setelah commit
   * sukses, best-effort, supaya kegagalan di tengah tidak menghapus satu-satunya
   * salinan berkas.
   */
  async promote(
    reviewId: number,
    user: AuthedUser,
    opts: {
      expectedVersion?: number;
      reason?: string | null;
      copyObject: (from: string, to: string) => Promise<string>;
    },
  ) {
    assertCanMutateKyc(user.role, "dataReviewDecision");
    const preReview = await this.loadReview(reviewId);
    if (preReview.status !== "SUBMITTED") {
      throw new BadRequestException(
        "Hanya review berstatus SUBMITTED yang dapat disetujui.",
      );
    }
    this.assertVersion(preReview, opts.expectedVersion);
    // Compliance menyetujui versi yang ia baca. Kalau draft bergerak setelah
    // submit, approval-nya menyetujui sesuatu yang tidak pernah ia lihat.
    if (
      preReview.submitted_version != null &&
      Number(preReview.version) !== Number(preReview.submitted_version)
    ) {
      throw new ConflictException({
        code: "DATA_REVIEW_VERSION_CHANGED",
        message:
          "Draft berubah setelah diajukan. Tinjau ulang perubahan terbaru sebelum menyetujui.",
        current_version: Number(preReview.version),
        submitted_version: Number(preReview.submitted_version),
      });
    }
    await this.assertBaselineUnchanged(preReview);

    const appId = Number(preReview.application_id);
    const changes = await this.activeChanges(reviewId);

    // ── FASE 1 (di luar transaksi): salin objek staging ke key final ────────
    const docCopies: { changeId: number; finalKey: string }[] = [];
    for (const c of changes) {
      if (c.entity_type !== "DOCUMENT") continue;
      if (c.operation === "DELETE") continue;
      if (c.promoted_at) continue; // sudah pernah dipromosikan (retry)
      if (!c.staged_object_key) continue;
      const finalKey = this.finalDocumentKey(appId, reviewId, Number(c.id), c.staged_object_key);
      const storedKey = await opts.copyObject(c.staged_object_key, finalKey);
      docCopies.push({ changeId: Number(c.id), finalKey: storedKey });
    }

    // ── FASE 2: transaksi DB tunggal ───────────────────────────────────────
    const client = await this.pool.connect();
    const actorId = resolveUserId(user);
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

      // Kunci baris review: dua approval bersamaan tidak bisa dua-duanya lolos.
      const { rows: lockedRows } = await client.query(
        `SELECT * FROM application_data_reviews WHERE id=$1 FOR UPDATE`,
        [reviewId],
      );
      const locked = lockedRows[0];
      if (!locked) throw new NotFoundException("Data review not found");
      if (locked.status !== "SUBMITTED") {
        throw new BadRequestException(
          "Hanya review berstatus SUBMITTED yang dapat disetujui.",
        );
      }

      this.assertVersion(locked, opts.expectedVersion);
      if (
        locked.submitted_version != null &&
        Number(locked.version) !== Number(locked.submitted_version)
      ) {
        throw new ConflictException({
          code: "DATA_REVIEW_VERSION_CHANGED",
          message:
            "Draft berubah setelah diajukan. Tinjau ulang perubahan terbaru sebelum menyetujui.",
          current_version: Number(locked.version),
          submitted_version: Number(locked.submitted_version),
        });
      }

      // Ulangi pemeriksaan di transaksi SERIALIZABLE. Pemeriksaan awal
      // menghindari copy storage yang sia-sia; pemeriksaan ini menutup race
      // antara preflight/copy dan promosi tabel live.
      await this.assertBaselineUnchanged(
        { ...preReview, ...locked, application_id: appId },
        client,
      );

      const lockedChanges = await this.activeChanges(reviewId, client);

      for (const c of lockedChanges) {
        if (c.promoted_at) continue;

        if (c.entity_type === "PERSON" || c.entity_type === "BUSINESS") {
          const isPerson = c.entity_type === "PERSON";
          const table = isPerson ? "persons" : "business_entities";
          const allowed = isPerson ? PERSON_EDITABLE_COLUMNS : BUSINESS_EDITABLE_COLUMNS;
          const patch = c.after_data ?? {};
          const cols = Object.keys(patch).filter((k) => allowed.includes(k));
          if (cols.length === 0) continue;
          const sets = cols.map((k, i) => `${k}=$${i + 2}`).join(", ");
          await client.query(
            `UPDATE ${table} SET ${sets} WHERE id=$1`,
            [c.target_id, ...cols.map((k) => patch[k])],
          );
        } else if (c.entity_type === "PARTY") {
          // preReview (hasil JOIN applications), bukan `locked` — baris
          // application_data_reviews polos tidak membawa business_id.
          await this.promoteParty(client, preReview, c);
        } else if (c.entity_type === "DOCUMENT") {
          const copied = docCopies.find((d) => d.changeId === Number(c.id));
          await this.promoteDocument(client, appId, c, copied?.finalKey ?? null);
        } else if (c.entity_type === "EDD") {
          await this.promoteEdd(client, appId, c, actorId);
        }

        await client.query(
          `UPDATE application_data_review_changes
              SET promoted_at=now(), updated_at=now() WHERE id=$1`,
          [c.id],
        );
      }

      const { rows: finalRows } = await client.query(
        `UPDATE application_data_reviews
            SET status='APPROVED',
                reviewed_by=$2,
                reviewed_at=now(),
                approved_at=now(),
                decision_notes=$3,
                updated_at=now()
          WHERE id=$1
          RETURNING *`,
        [reviewId, actorId, opts.reason ?? null],
      );

      await client.query("COMMIT");
      return { review: finalRows[0], promotedCount: lockedChanges.length, docCopies };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private async promoteParty(client: PoolClient, review: any, c: any) {
    const data = c.after_data ?? {};
    const personCols = ["full_name", "identity_type", "identity_number", "dob", "pob", "nationality", "phone", "email"];
    const partyCols = ["role", "address", "ownership_percentage", "identity_document_type",
      "source_of_funds", "source_of_funds_other", "source_of_wealth", "source_of_wealth_other",
      "cif_relationship_type"];

    if (c.operation === "DELETE") {
      // Soft delete — baris historis party tidak pernah dihapus keras oleh
      // Pengkinian Data. is_active sudah dibaca trigger CDD sejak migrasi 0005.
      await client.query(
        `UPDATE business_parties SET is_active=FALSE, updated_at=now() WHERE id=$1`,
        [c.target_id],
      );
      return;
    }

    if (c.operation === "ADD") {
      const idType = data.identity_type ?? "KTP";
      const idNumber = data.identity_number ?? null;
      let personId: number | null = null;
      if (idNumber) {
        const { rows } = await client.query(
          `SELECT id FROM persons WHERE identity_type=$1 AND identity_number=$2 LIMIT 1`,
          [idType, idNumber],
        );
        personId = rows[0]?.id ?? null;
      }
      if (personId) {
        const suppliedPersonCols = personCols.filter((k) => k in data);
        if (suppliedPersonCols.length > 0) {
          const sets = suppliedPersonCols
            .map((k, i) => `${k}=$${i + 2}`)
            .join(", ");
          await client.query(
            `UPDATE persons SET ${sets} WHERE id=$1`,
            [personId, ...suppliedPersonCols.map((k) => data[k])],
          );
        }
      } else {
        const { rows } = await client.query(
          `INSERT INTO persons (full_name, identity_type, identity_number, dob, pob,
                                nationality, phone, email, cif_relationship_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'BO'))
           RETURNING id`,
          [
            data.full_name, idType, idNumber, data.dob ?? null, data.pob ?? null,
            data.nationality ?? null, data.phone ?? null, data.email ?? null,
            data.cif_relationship_type ?? null,
          ],
        );
        personId = rows[0].id;
      }

      const cols = partyCols.filter((k) => k in data);
      const insertCols = ["business_id", "person_id", ...cols];
      const values = [review.business_id, personId, ...cols.map((k) => data[k])];
      const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(",");
      const conflictUpdates = [
        "is_active=TRUE",
        ...cols.map((k) => `${k}=EXCLUDED.${k}`),
        "updated_at=now()",
      ];
      const { rows: inserted } = await client.query(
        `INSERT INTO business_parties (${insertCols.join(",")})
         VALUES (${placeholders})
         ON CONFLICT (business_id, person_id, role)
         DO UPDATE SET ${conflictUpdates.join(", ")}
         RETURNING id`,
        values,
      );
      await client.query(
        `UPDATE application_data_review_changes SET promoted_target_id=$2 WHERE id=$1`,
        [c.id, inserted[0].id],
      );
      return;
    }

    // UPDATE
    const pCols = personCols.filter((k) => k in data);
    if (pCols.length > 0) {
      const sets = pCols.map((k, i) => `${k}=$${i + 2}`).join(", ");
      await client.query(
        `UPDATE persons SET ${sets}
          WHERE id = (SELECT person_id FROM business_parties WHERE id=$1)`,
        [c.target_id, ...pCols.map((k) => data[k])],
      );
    }
    const bCols = partyCols.filter((k) => k in data);
    if (bCols.length > 0) {
      const sets = bCols.map((k, i) => `${k}=$${i + 2}`).join(", ");
      await client.query(
        `UPDATE business_parties SET ${sets}, updated_at=now() WHERE id=$1`,
        [c.target_id, ...bCols.map((k) => data[k])],
      );
    }
  }

  private async promoteDocument(
    client: PoolClient,
    appId: number,
    c: any,
    finalKey: string | null,
  ) {
    if (c.operation === "DELETE") {
      // Baris live baru dihapus SEKARANG — sebelum approval ia tetap utuh.
      await client.query(`DELETE FROM documents WHERE id=$1`, [c.target_id]);
      return;
    }

    const data = c.after_data ?? {};
    const fileUri = finalKey ?? data.file_uri ?? c.staged_object_key;

    if (c.operation === "REPLACE" && c.target_id) {
      // Dokumen lama dihapus barisnya, versi baru masuk sebagai baris baru —
      // konsisten dengan pola append-only tabel documents.
      await client.query(`DELETE FROM documents WHERE id=$1`, [c.target_id]);
    }

    const { rows } = await client.query(
      `INSERT INTO documents (application_id, doc_type, file_uri, status)
       VALUES ($1,$2,$3,'UPLOADED')
       RETURNING id`,
      [appId, data.doc_type, fileUri],
    );
    await client.query(
      `UPDATE application_data_review_changes SET promoted_target_id=$2 WHERE id=$1`,
      [c.id, rows[0].id],
    );
  }

  private async promoteEdd(client: PoolClient, appId: number, c: any, actorId: number | string) {
    const data = c.after_data ?? {};
    const cols = Object.keys(data).filter((k) => EDD_EDITABLE_SECTIONS.includes(k));
    if (cols.length === 0) return;

    const insertCols = ["application_id", ...cols, "created_by", "updated_by"];
    const values = [appId, ...cols.map((k) => JSON.stringify(data[k])), actorId, actorId];
    const placeholders = insertCols.map((_, i) =>
      cols.includes(insertCols[i]) ? `$${i + 1}::jsonb` : `$${i + 1}`,
    ).join(",");
    const updates = cols.map((k) => `${k}=EXCLUDED.${k}`).join(", ");

    await client.query(
      `INSERT INTO application_edd (${insertCols.join(",")})
       VALUES (${placeholders})
       ON CONFLICT (application_id)
       DO UPDATE SET ${updates}, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      values,
    );
  }

  /** Bentuk satu baris change untuk UI diff — pakai nama aktor, bukan ID. */
  presentChange(c: any) {
    return {
      id: Number(c.id),
      public_id: c.public_id,
      entity_type: c.entity_type,
      operation: c.operation,
      target_id: c.target_id != null ? Number(c.target_id) : null,
      before_data: c.before_data,
      after_data: c.after_data,
      staged_object_key: c.staged_object_key,
      promoted_at: c.promoted_at,
      created_by_name: c.created_by_name ?? null,
      created_at: c.created_at,
    };
  }
}
