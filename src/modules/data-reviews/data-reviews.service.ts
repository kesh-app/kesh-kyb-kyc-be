import {
  Inject,
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { Pool } from "pg";
import { resolveUserId } from "../../common/auth.util";
import {
  InitiateDataReviewDto,
  DataReviewDecisionDto,
  ListDataReviewsQueryDto,
} from "./dto";

type AuthedUser = { sub?: number | string; id?: number | string; role: string };

// Periode pengkinian data berdasarkan tingkat risiko (dari first submitted date).
const RISK_YEARS: Record<string, number> = { HIGH: 1, MEDIUM: 2, LOW: 3 };

// Review yang masih "aktif" (belum terminal) — menghalangi initiate ganda.
const ACTIVE_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "IN_COMPLIANCE_REVIEW",
  "RETURNED_FOR_REVISION",
];

@Injectable()
export class DataReviewsService {
  constructor(@Inject("PG_POOL") private readonly pool: Pool) {}

  private async getApplication(appId: number) {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.status, a.submitted_at, a.first_submitted_at,
              COALESCE(ar.override_level, ar.risk_level) AS risk_level
         FROM applications a
         LEFT JOIN application_risk ar ON ar.application_id = a.id
        WHERE a.id = $1`,
      [appId],
    );
    if (!rows[0]) throw new NotFoundException("Application not found");
    return rows[0];
  }

  /** base = first_submitted_at (fallback submitted_at). due = base + N tahun per risk. */
  private computeDue(app: {
    risk_level: string | null;
    first_submitted_at: string | null;
    submitted_at: string | null;
  }): { base: Date | null; dueAt: Date | null } {
    const baseRaw = app.first_submitted_at ?? app.submitted_at;
    if (!baseRaw || !app.risk_level || !(app.risk_level in RISK_YEARS)) {
      return { base: baseRaw ? new Date(baseRaw) : null, dueAt: null };
    }
    const base = new Date(baseRaw);
    const dueAt = new Date(base);
    dueAt.setFullYear(dueAt.getFullYear() + RISK_YEARS[app.risk_level]);
    return { base, dueAt };
  }

  private async fetchLatestReview(appId: number) {
    const { rows } = await this.pool.query(
      `SELECT * FROM application_data_reviews
        WHERE application_id = $1 ORDER BY id DESC LIMIT 1`,
      [appId],
    );
    return rows[0] ?? null;
  }

  private async resolveReviewNo(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const rand = Math.random().toString(36).toUpperCase().slice(2, 7).padEnd(5, "0");
      const candidate = `KESH-DR-${date}-${rand}`;
      const dup = await this.pool.query(
        `SELECT 1 FROM application_data_reviews WHERE review_no = $1 LIMIT 1`,
        [candidate],
      );
      if ((dup.rowCount ?? 0) === 0) return candidate;
    }
    throw new BadRequestException("Failed to generate review_no, please retry");
  }

  // ---------------------------------------------------------------------------
  // LIST / WORKLIST — GET /data-reviews
  // Sumber utama = applications, diperkaya review terakhir (kalau ada).
  // Due date & due_status dihitung di SQL supaya bisa difilter + dipaginasi.
  // ---------------------------------------------------------------------------
  async list(query: ListDataReviewsQueryDto = {}) {
    const { q, risk_level, due_status, review_status, customer_type } = query;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (risk_level) {
      params.push(risk_level);
      conditions.push(`risk_level = $${params.length}`);
    }
    if (due_status) {
      params.push(due_status);
      conditions.push(`due_status = $${params.length}`);
    }
    if (review_status) {
      params.push(review_status);
      conditions.push(`review_status = $${params.length}`);
    }
    if (customer_type) {
      params.push(customer_type);
      conditions.push(`customer_type = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      const pi = params.length;
      params.push(`%${q.replace(/-/g, "")}%`);
      const ci = params.length;
      conditions.push(
        `(customer_name ILIKE $${pi} OR REPLACE(COALESCE(cif_no,''),'-','') ILIKE $${ci})`,
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const cte = `
      WITH base AS (
        SELECT
          a.id::int AS application_id,
          CASE WHEN a.type = 'INDIVIDUAL' AND p.cif_relationship_type = 'WIC' THEN NULL
               WHEN a.type = 'INDIVIDUAL' THEN p.cif_no ELSE b.cif_no END AS cif_no,
          CASE WHEN a.type = 'INDIVIDUAL' THEN p.full_name ELSE b.legal_name END AS customer_name,
          a.type AS customer_type,
          a.status,
          a.created_at,
          COALESCE(ar.override_level, ar.risk_level) AS risk_level,
          COALESCE(a.first_submitted_at, a.submitted_at) AS first_submitted_at,
          dr.id::int         AS review_id,
          dr.review_no       AS review_no,
          dr.review_type     AS review_type,
          dr.status          AS review_status,
          dr.initiated_by::int AS review_initiated_by,
          dr.initiated_at    AS review_initiated_at,
          dr.submitted_at    AS review_submitted_at,
          dr.reviewed_at     AS review_reviewed_at,
          dr.decision_notes  AS review_decision_notes
        FROM applications a
        LEFT JOIN persons p ON p.id = a.person_id
        LEFT JOIN business_entities b ON b.id = a.business_id
        LEFT JOIN application_risk ar ON ar.application_id = a.id
        LEFT JOIN LATERAL (
          SELECT r.* FROM application_data_reviews r
           WHERE r.application_id = a.id
           ORDER BY r.id DESC LIMIT 1
        ) dr ON TRUE
      ),
      periodic AS (
        SELECT base.*,
          CASE risk_level WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END
            AS review_period_years
        FROM base
      ),
      dated AS (
        SELECT periodic.*,
          CASE WHEN review_period_years IS NULL OR first_submitted_at IS NULL THEN NULL
               ELSE first_submitted_at + (review_period_years * INTERVAL '1 year') END AS due_at
        FROM periodic
      ),
      rows_ AS (
        SELECT dated.*,
          CASE
            WHEN risk_level IS NULL THEN 'NEED_RISK_SCORE'
            WHEN first_submitted_at IS NULL THEN 'NO_SUBMITTED_DATE'
            WHEN due_at IS NULL THEN 'NOT_DUE'
            WHEN due_at::date < CURRENT_DATE THEN 'OVERDUE'
            WHEN due_at::date = CURRENT_DATE THEN 'DUE'
            WHEN due_at::date <= CURRENT_DATE + 30 THEN 'DUE_SOON'
            ELSE 'NOT_DUE'
          END AS due_status,
          CASE WHEN due_at IS NULL THEN NULL ELSE (due_at::date - CURRENT_DATE) END
            AS days_until_due
        FROM dated
      )
    `;

    const [{ rows }, { rows: countRows }] = await Promise.all([
      this.pool.query(
        `${cte}
         SELECT * FROM rows_ ${where}
          ORDER BY
            CASE WHEN review_status = 'SUBMITTED' THEN 0 ELSE 1 END,
            CASE due_status WHEN 'OVERDUE' THEN 0 WHEN 'DUE' THEN 1 WHEN 'DUE_SOON' THEN 2 ELSE 3 END,
            due_at ASC NULLS LAST,
            created_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      this.pool.query(
        `${cte} SELECT COUNT(*) AS total FROM rows_ ${where}`,
        params,
      ),
    ]);

    return {
      data: rows.map((r: any) => ({
        application_id: r.application_id,
        cif_no: r.cif_no,
        customer_name: r.customer_name,
        customer_type: r.customer_type,
        status: r.status,
        risk_level: r.risk_level,
        first_submitted_at: r.first_submitted_at,
        due_at: r.due_at,
        review_period_years: r.review_period_years,
        due_status: r.due_status,
        days_until_due: r.days_until_due,
        // "aktif" = review terakhir apa pun statusnya, supaya FE bisa menampilkan
        // hasil keputusan terakhir juga (APPROVED/REJECTED).
        active_review: r.review_id
          ? {
              id: r.review_id,
              review_no: r.review_no,
              review_type: r.review_type,
              status: r.review_status,
              initiated_by: r.review_initiated_by,
              initiated_at: r.review_initiated_at,
              submitted_at: r.review_submitted_at,
              reviewed_at: r.review_reviewed_at,
              decision_notes: r.review_decision_notes,
            }
          : null,
      })),
      total: Number(countRows[0].total),
      page,
      limit,
    };
  }

  // ---------------------------------------------------------------------------
  // STATUS
  // ---------------------------------------------------------------------------
  async getStatus(appId: number) {
    const app = await this.getApplication(appId);
    const { base, dueAt } = this.computeDue(app);

    const isDue = dueAt ? Date.now() >= dueAt.getTime() : false;
    const latest = await this.fetchLatestReview(appId);
    const active =
      latest && ACTIVE_STATUSES.includes(latest.status) ? latest : null;

    // Status yang ditampilkan: workflow review aktif > status periodik.
    let status: string;
    if (active) {
      status = active.status;
    } else if (!app.risk_level) {
      status = "NEED_RISK_SCORE";
    } else if (!dueAt) {
      status = "NOT_DUE";
    } else {
      status = isDue ? "DUE" : "NOT_DUE";
    }

    return {
      application_id: appId,
      risk_level: app.risk_level ?? null,
      base_submitted_at: base ? base.toISOString() : null,
      due_at: dueAt ? dueAt.toISOString() : null,
      is_due: isDue,
      status,
      active_review: active
        ? { id: active.id, review_no: active.review_no, status: active.status }
        : null,
      last_review: latest
        ? {
            id: latest.id,
            review_no: latest.review_no,
            review_type: latest.review_type,
            status: latest.status,
            initiated_at: latest.initiated_at,
            submitted_at: latest.submitted_at,
            reviewed_at: latest.reviewed_at,
            decision_notes: latest.decision_notes,
          }
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // INITIATE / REQUEST — ComplianceLead/SystemAdmin/Director
  // ---------------------------------------------------------------------------
  async initiate(appId: number, user: AuthedUser, dto: InitiateDataReviewDto) {
    const app = await this.getApplication(appId);

    // Bila sudah ada review aktif → kembalikan yang ada (idempoten).
    const latest = await this.fetchLatestReview(appId);
    if (latest && ACTIVE_STATUSES.includes(latest.status)) {
      return latest;
    }

    const { base, dueAt } = this.computeDue(app);
    const reviewNo = await this.resolveReviewNo();
    const actorId = resolveUserId(user);

    const { rows } = await this.pool.query(
      `INSERT INTO application_data_reviews
         (application_id, review_no, review_type, risk_level_at_review,
          base_submitted_at, due_at, status, initiated_by, initiated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7, now())
       RETURNING *`,
      [
        appId,
        reviewNo,
        dto.review_type ?? "MANUAL",
        app.risk_level ?? null,
        base ? base.toISOString() : null,
        dueAt ? dueAt.toISOString() : null,
        actorId,
      ],
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // SUBMIT — FrontDesk/SystemAdmin/Director
  // ---------------------------------------------------------------------------
  async submit(appId: number, user: AuthedUser) {
    const latest = await this.fetchLatestReview(appId);
    if (!latest || !["DRAFT", "RETURNED_FOR_REVISION"].includes(latest.status)) {
      throw new BadRequestException(
        "Tidak ada review pengkinian data berstatus DRAFT/RETURNED_FOR_REVISION untuk disubmit.",
      );
    }

    const { rows } = await this.pool.query(
      `UPDATE application_data_reviews
          SET status='SUBMITTED', submitted_by=$2, submitted_at=now(), updated_at=now()
        WHERE id=$1
        RETURNING *`,
      [latest.id, resolveUserId(user)],
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // DECISION — ComplianceLead/SystemAdmin/Director
  // ---------------------------------------------------------------------------
  async decision(appId: number, user: AuthedUser, dto: DataReviewDecisionDto) {
    const latest = await this.fetchLatestReview(appId);
    if (!latest || !["SUBMITTED", "IN_COMPLIANCE_REVIEW"].includes(latest.status)) {
      throw new BadRequestException(
        "Tidak ada review pengkinian data berstatus SUBMITTED untuk diputuskan.",
      );
    }

    const reason = dto.reason?.trim() || null;
    if (
      (dto.decision === "RETURN_FOR_REVISION" || dto.decision === "REJECTED") &&
      !reason
    ) {
      throw new BadRequestException("reason wajib diisi untuk aksi ini.");
    }

    const NEXT: Record<string, string> = {
      APPROVED: "APPROVED",
      RETURN_FOR_REVISION: "RETURNED_FOR_REVISION",
      REJECTED: "REJECTED",
    };

    const { rows } = await this.pool.query(
      `UPDATE application_data_reviews
          SET status=$2, reviewed_by=$3, reviewed_at=now(),
              decision_notes=$4, updated_at=now()
        WHERE id=$1
        RETURNING *`,
      [latest.id, NEXT[dto.decision], resolveUserId(user), reason],
    );
    return rows[0];
  }
}
