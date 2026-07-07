import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Pool } from "pg";
import { resolveUserId } from "../../common/auth.util";
import {
  ComplianceReviewDto,
  DirectorReviewDto,
  UpdateReportDto,
} from "./dto";

type AuthedUser = { sub?: number | string; id?: number | string; role: string };

type TriggerKind = "LTKT" | "LTKM";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface EvalTrigger {
  trigger_type: TriggerKind;
  rule_code: string;
  rule_name: string;
  severity: Severity;
  score?: number | null;
  amount?: number | null;
  details: Record<string, any>;
}

// ── Threshold constants (mudah diubah oleh compliance) ───────────────────────
const CASH_THRESHOLD = 500_000_000; // LTKT cash single / aggregate
const HIGH_VALUE_THRESHOLD = 100_000_000; // LTKM high-value alert
const MANY_BENEFICIARIES_THRESHOLD = 5; // LTKM distinct beneficiaries/day

const SEVERITY_RANK: Record<Severity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

// Status yang dianggap "sudah selesai" → tidak boleh di-dedup/append lagi.
const CLOSED_STATUSES = [
  "CLOSED_FALSE_POSITIVE",
  "COMPLIANCE_REJECTED",
  "DIRECTOR_REJECTED",
  "REPORTED",
  "ARCHIVED",
];

const PEP_CODES = [
  "WATCHLIST_PEP_CONFIRMED",
  "WATCHLIST_PEP_CANDIDATE",
  "INDIVIDUAL_PEP_SELF_DECLARED",
];
const SANCTION_CODES = [
  "WATCHLIST_DTTOT_CONFIRMED",
  "WATCHLIST_DTTOT_CANDIDATE",
  "WATCHLIST_PPPSPM_CONFIRMED",
  "WATCHLIST_PPPSPM_CANDIDATE",
];

// LTKM rules yang bersifat "classifying" — hanya rule ini yang boleh menjadikan
// case bertipe LTKM/BOTH. Rule di luar ini (mis. HIGH_VALUE_TRANSFER) hanya
// supporting/internal alert dan TIDAK mengklasifikasikan case sebagai LTKM.
// LTKT selalu classifying (threshold-based, wajib lapor).
const CLASSIFYING_LTKM_CODES = [
  "LTKM_HIGH_RISK_CUSTOMER",
  "LTKM_PEP_RELATED",
  "LTKM_SANCTION_RELATED",
  "LTKM_EDD_RECOMMEND_LTKM",
  "LTKM_STRUCTURING_DAILY",
  "LTKM_MANY_BENEFICIARIES_DAILY",
];

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(@Inject("PG_POOL") private readonly pool: Pool) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private maxSeverity(list: EvalTrigger[]): Severity {
    let best: Severity = "LOW";
    for (const t of list) {
      if (SEVERITY_RANK[t.severity] > SEVERITY_RANK[best]) best = t.severity;
    }
    return best;
  }

  private isCash(row: any): boolean {
    const method = String(row.transfer_method ?? "").toUpperCase();
    const channel = String(row.transfer_channel ?? "").toUpperCase();
    const info = row.additional_info ?? {};
    const funding = String(info.funding_method ?? "").toUpperCase();
    const instrument = String(info.payment_instrument ?? "").toUpperCase();
    return (
      method === "CASH" ||
      channel === "CASH" ||
      funding === "CASH" ||
      instrument === "CASH"
    );
  }

  private async generateCaseNo(): Promise<string> {
    const { rows } = await this.pool.query(
      `SELECT nextval('monitoring_case_seq') AS seq`,
    );
    const seq = String(rows[0].seq).padStart(6, "0");
    const now = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    return `MON-${datePart}-${seq}`;
  }

  private async audit(
    actorId: number | string | null,
    action: string,
    objectId: string,
    before: any,
    after: any,
  ) {
    try {
      await this.pool.query(
        `INSERT INTO audit_logs(actor_id, action, object_type, object_id, before_json, after_json)
         VALUES ($1,$2,'MONITORING_CASE',$3,$4,$5)`,
        [actorId, action, objectId, before ?? null, after ?? null],
      );
    } catch (e: any) {
      // audit tidak boleh menggagalkan operasi utama
      this.logger.warn(`audit failed: ${e?.message}`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Trigger engine
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Kumpulkan konteks transfer + sender application + risk + EDD.
   * Return null jika transfer tidak ditemukan.
   */
  private async loadTransferContext(transferId: number) {
    const { rows } = await this.pool.query(
      `SELECT t.id, t.amount, t.transfer_method, t.transfer_channel, t.additional_info,
              t.beneficiary_account_number, t.sender_application_id,
              COALESCE(t.transaction_date, t.requested_transfer_at, t.created_at) AS txn_at,
              a.id AS application_id, a.type AS app_type, a.person_id, a.business_id,
              r.risk_level, r.risk_factors,
              COALESCE(p.cif_no, b.cif_no)      AS cif_no,
              COALESCE(p.full_name, b.legal_name) AS customer_name
       FROM transfers t
       LEFT JOIN applications a ON a.id = t.sender_application_id
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       LEFT JOIN application_risk r ON r.application_id = a.id
       WHERE t.id = $1`,
      [transferId],
    );
    return rows[0] ?? null;
  }

  /**
   * Ambil semua transfer dengan CIF sama pada hari kalender yang sama
   * (berbasis COALESCE(transaction_date, requested_transfer_at, created_at)).
   */
  private async loadSameCifSameDay(cifNo: string, txnAt: Date | string) {
    const { rows } = await this.pool.query(
      `SELECT t.id, t.amount, t.transfer_method, t.transfer_channel, t.additional_info,
              t.beneficiary_account_number
       FROM transfers t
       JOIN applications a ON a.id = t.sender_application_id
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       WHERE COALESCE(p.cif_no, b.cif_no) = $1
         AND COALESCE(t.transaction_date, t.requested_transfer_at, t.created_at)::date = $2::date`,
      [cifNo, txnAt],
    );
    return rows;
  }

  /**
   * Evaluasi rules terhadap satu transfer, return daftar trigger yang menyala.
   */
  private async evaluateRules(ctx: any): Promise<EvalTrigger[]> {
    const triggers: EvalTrigger[] = [];
    const amount = Number(ctx.amount ?? 0);
    const cashCurrent = this.isCash(ctx);
    const riskLevel = String(ctx.risk_level ?? "").toUpperCase();

    // risk_factors JSONB → array kode
    let factorCodes: string[] = [];
    const rf = ctx.risk_factors;
    if (Array.isArray(rf)) {
      factorCodes = rf.map((f: any) => f?.code).filter(Boolean);
    }

    // ── LTKT: single cash ≥ 500M ──
    if (cashCurrent && amount >= CASH_THRESHOLD) {
      triggers.push({
        trigger_type: "LTKT",
        rule_code: "LTKT_CASH_SINGLE_500M",
        rule_name: "Transaksi tunai tunggal ≥ Rp500.000.000",
        severity: "HIGH",
        amount,
        details: { amount, threshold: CASH_THRESHOLD },
      });
    }

    // ── Aggregate/structuring/many-beneficiaries butuh data 1 hari sama CIF ──
    if (ctx.cif_no && ctx.txn_at) {
      const sameDay = await this.loadSameCifSameDay(ctx.cif_no, ctx.txn_at);

      const cashRows = sameDay.filter((r) => this.isCash(r));
      const cashTotal = cashRows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
      const dailyTotal = sameDay.reduce((s, r) => s + Number(r.amount ?? 0), 0);

      // LTKT aggregate: total tunai harian ≥ 500M lintas ≥ 2 transaksi
      if (cashRows.length >= 2 && cashTotal >= CASH_THRESHOLD) {
        triggers.push({
          trigger_type: "LTKT",
          rule_code: "LTKT_CASH_AGGREGATE_DAILY_500M",
          rule_name: "Akumulasi transaksi tunai harian ≥ Rp500.000.000",
          severity: "HIGH",
          amount: cashTotal,
          details: {
            cash_total: cashTotal,
            cash_count: cashRows.length,
            threshold: CASH_THRESHOLD,
          },
        });
      }

      // LTKM structuring: banyak transaksi < 500M tapi total ≥ 500M
      const belowThreshold = sameDay.filter(
        (r) => Number(r.amount ?? 0) < CASH_THRESHOLD,
      );
      if (
        sameDay.length >= 2 &&
        belowThreshold.length === sameDay.length &&
        dailyTotal >= CASH_THRESHOLD
      ) {
        triggers.push({
          trigger_type: "LTKM",
          rule_code: "LTKM_STRUCTURING_DAILY",
          rule_name: "Dugaan structuring — akumulasi harian ≥ Rp500.000.000",
          severity: "HIGH",
          amount: dailyTotal,
          details: {
            daily_total: dailyTotal,
            transaction_count: sameDay.length,
            threshold: CASH_THRESHOLD,
          },
        });
      }

      // LTKM many beneficiaries: ≥ 5 rekening tujuan berbeda dalam sehari
      const distinctBenef = new Set(
        sameDay
          .map((r) => r.beneficiary_account_number)
          .filter((x) => x !== null && x !== undefined && x !== ""),
      );
      if (distinctBenef.size >= MANY_BENEFICIARIES_THRESHOLD) {
        triggers.push({
          trigger_type: "LTKM",
          rule_code: "LTKM_MANY_BENEFICIARIES_DAILY",
          rule_name: `Transaksi ke ≥ ${MANY_BENEFICIARIES_THRESHOLD} rekening tujuan berbeda dalam sehari`,
          severity: "MEDIUM",
          details: {
            distinct_beneficiaries: distinctBenef.size,
            threshold: MANY_BENEFICIARIES_THRESHOLD,
          },
        });
      }
    }

    // ── LTKM: high risk customer ──
    if (riskLevel === "HIGH") {
      triggers.push({
        trigger_type: "LTKM",
        rule_code: "LTKM_HIGH_RISK_CUSTOMER",
        rule_name: "Nasabah risk level HIGH",
        severity: "HIGH",
        details: { risk_level: riskLevel },
      });
    }

    // ── LTKM: PEP related ──
    const pepHits = factorCodes.filter((c) => PEP_CODES.includes(c));
    if (pepHits.length) {
      triggers.push({
        trigger_type: "LTKM",
        rule_code: "LTKM_PEP_RELATED",
        rule_name: "Nasabah terkait PEP",
        severity: "HIGH",
        details: { risk_factors: pepHits },
      });
    }

    // ── LTKM: sanction related (DTTOT/PPPSPM) ──
    const sanctionHits = factorCodes.filter((c) => SANCTION_CODES.includes(c));
    if (sanctionHits.length) {
      triggers.push({
        trigger_type: "LTKM",
        rule_code: "LTKM_SANCTION_RELATED",
        rule_name: "Nasabah terkait DTTOT/PPPSPM",
        severity: "CRITICAL",
        details: { risk_factors: sanctionHits },
      });
    }

    // ── LTKM: EDD recommend LTKM ──
    if (ctx.application_id) {
      const { rows: eddRows } = await this.pool.query(
        `SELECT officer_analysis, compliance_decision, director_decision
         FROM application_edd WHERE application_id=$1`,
        [ctx.application_id],
      );
      const edd = eddRows[0];
      if (edd) {
        const officer = edd.officer_analysis ?? {};
        const compliance = edd.compliance_decision ?? {};
        const director = edd.director_decision ?? {};
        const recs = officer.follow_up_recommendations;
        const recArray = Array.isArray(recs)
          ? recs.map((x: any) => String(x).toUpperCase())
          : typeof recs === "string"
            ? [recs.toUpperCase()]
            : [];
        const eddRecommendsLtkm =
          recArray.includes("REPORT_AS_LTKM") ||
          String(compliance.decision ?? "").toUpperCase() === "RECOMMENDED_LTKM" ||
          String(director.decision ?? "").toUpperCase() === "RECOMMENDED_LTKM";
        if (eddRecommendsLtkm) {
          triggers.push({
            trigger_type: "LTKM",
            rule_code: "LTKM_EDD_RECOMMEND_LTKM",
            rule_name: "Rekomendasi LTKM dari hasil EDD",
            severity: "HIGH",
            details: {
              officer_recommendations: recArray,
              compliance_decision: compliance.decision ?? null,
              director_decision: director.decision ?? null,
            },
          });
        }
      }
    }

    // ── LTKM: high value transfer (supporting alert only, NON-classifying) ──
    // Nilai besar tidak otomatis mencurigakan → tidak mengklasifikasikan case
    // sebagai LTKM. Hanya disimpan sebagai supporting alert.
    if (amount >= HIGH_VALUE_THRESHOLD) {
      triggers.push({
        trigger_type: "LTKM",
        rule_code: "LTKM_HIGH_VALUE_TRANSFER",
        rule_name: "Transaksi bernilai besar ≥ Rp100.000.000 (supporting alert)",
        severity: riskLevel === "HIGH" ? "HIGH" : "MEDIUM",
        amount,
        details: { amount, threshold: HIGH_VALUE_THRESHOLD, supporting: true },
      });
    }

    return triggers;
  }

  /** LTKT selalu classifying; LTKM classifying hanya jika rule ada di whitelist. */
  private isClassifying(t: { trigger_type: string; rule_code: string }): boolean {
    if (t.trigger_type === "LTKT") return true;
    return CLASSIFYING_LTKM_CODES.includes(t.rule_code);
  }

  /** Tentukan case_type hanya dari trigger classifying (supporting alert diabaikan). */
  private determineCaseType(
    triggers: { trigger_type: string; rule_code: string }[],
  ): "LTKT" | "LTKM" | "BOTH" {
    const classifying = triggers.filter((t) => this.isClassifying(t));
    const hasLtkt = classifying.some((t) => t.trigger_type === "LTKT");
    const hasLtkm = classifying.some((t) => t.trigger_type === "LTKM");
    if (hasLtkt && hasLtkm) return "BOTH";
    if (hasLtkt) return "LTKT";
    return "LTKM";
  }

  /** Due date: LTKT +14 hari (dari txn), LTKM +3 hari (dari now), BOTH → paling awal. */
  private computeDueDate(
    caseType: "LTKT" | "LTKM" | "BOTH",
    txnAt: Date | string,
    detectedAt: Date,
  ): Date {
    const txn = new Date(txnAt);
    const ltktDue = new Date(txn);
    ltktDue.setDate(ltktDue.getDate() + 14);
    const ltkmDue = new Date(detectedAt);
    ltkmDue.setDate(ltkmDue.getDate() + 3);

    if (caseType === "LTKT") return ltktDue;
    if (caseType === "LTKM") return ltkmDue;
    return ltktDue < ltkmDue ? ltktDue : ltkmDue;
  }

  private buildSummary(triggers: EvalTrigger[]): string {
    return triggers.map((t) => `${t.trigger_type}: ${t.rule_name}`).join("; ");
  }

  /**
   * Jalankan trigger engine untuk sebuah transfer. Buat case baru atau append
   * trigger ke case aktif yang sudah ada (dedup per transfer_id).
   * Return { triggered: false } jika tidak ada trigger.
   */
  async evaluateTransfer(transferId: number, user?: AuthedUser) {
    const ctx = await this.loadTransferContext(transferId);
    if (!ctx) throw new NotFoundException("Transfer not found");

    const triggers = await this.evaluateRules(ctx);

    // Hanya trigger classifying yang boleh membuka case. Supporting alert
    // (mis. HIGH_VALUE_TRANSFER) tidak membuat case bila berdiri sendiri.
    const classifying = triggers.filter((t) => this.isClassifying(t));
    if (classifying.length === 0) {
      return { triggered: false as const };
    }

    const actorId = user ? resolveUserId(user) : null;
    const caseType = this.determineCaseType(triggers);
    const severity = this.maxSeverity(classifying);

    // Dedup: cari case aktif untuk transfer_id ini
    const { rows: existingRows } = await this.pool.query(
      `SELECT * FROM monitoring_cases
       WHERE transfer_id = $1 AND status <> ALL($2::text[])
       ORDER BY id DESC LIMIT 1`,
      [transferId, CLOSED_STATUSES],
    );
    const existing = existingRows[0];

    if (existing) {
      return this.appendTriggersToCase(existing, triggers, actorId);
    }

    // Buat case baru
    const caseNo = await this.generateCaseNo();
    const detectedAt = new Date();
    const dueDate = this.computeDueDate(caseType, ctx.txn_at, detectedAt);
    const summary = this.buildSummary(classifying);

    const { rows: caseRows } = await this.pool.query(
      `INSERT INTO monitoring_cases
         (case_no, case_type, source_type, source_id, transfer_id, application_id,
          cif_no, customer_name, status, severity, detected_at, due_date,
          trigger_summary, trigger_details, created_by, updated_by)
       VALUES ($1,$2,'TRANSFER',$3,$4,$5,$6,$7,'DETECTED',$8,$9,$10,$11,$12,$13,$13)
       RETURNING *`,
      [
        caseNo,
        caseType,
        transferId,
        transferId,
        ctx.application_id ?? null,
        ctx.cif_no ?? null,
        ctx.customer_name ?? null,
        severity,
        detectedAt,
        dueDate,
        summary,
        JSON.stringify({ rules: triggers.map((t) => t.rule_code) }),
        actorId,
      ],
    );
    const created = caseRows[0];

    await this.insertTriggers(created.id, triggers);
    await this.audit(actorId, "MONITORING_CASE_DETECTED", String(created.id), null, created);

    return this.getCaseWithTriggers(created.id);
  }

  private async insertTriggers(caseId: number, triggers: EvalTrigger[]) {
    for (const t of triggers) {
      await this.pool.query(
        `INSERT INTO monitoring_case_triggers
           (case_id, trigger_type, rule_code, rule_name, severity, score, amount, details)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          caseId,
          t.trigger_type,
          t.rule_code,
          t.rule_name,
          t.severity,
          t.score ?? null,
          t.amount ?? null,
          JSON.stringify(t.details ?? {}),
        ],
      );
    }
  }

  private async appendTriggersToCase(
    existing: any,
    triggers: EvalTrigger[],
    actorId: number | string | null,
  ) {
    // Trigger yang sudah ada (hindari duplikat rule_code)
    const { rows: existTrig } = await this.pool.query(
      `SELECT rule_code FROM monitoring_case_triggers WHERE case_id=$1`,
      [existing.id],
    );
    const existingCodes = new Set(existTrig.map((r) => r.rule_code));
    const newTriggers = triggers.filter((t) => !existingCodes.has(t.rule_code));

    if (newTriggers.length > 0) {
      await this.insertTriggers(existing.id, newTriggers);
    }

    // Recompute case_type & severity dari seluruh trigger case, hanya yang
    // classifying (supporting alert seperti HIGH_VALUE_TRANSFER diabaikan).
    const { rows: allTrig } = await this.pool.query(
      `SELECT trigger_type, rule_code, rule_name, severity FROM monitoring_case_triggers WHERE case_id=$1 ORDER BY id`,
      [existing.id],
    );
    const classifying = allTrig.filter((t) => this.isClassifying(t));
    const mergedType = this.determineCaseType(classifying);
    let mergedSeverity: Severity = "LOW";
    for (const t of classifying) {
      if (SEVERITY_RANK[t.severity as Severity] > SEVERITY_RANK[mergedSeverity]) {
        mergedSeverity = t.severity as Severity;
      }
    }
    const summary = classifying
      .map((t) => `${t.trigger_type}: ${t.rule_name}`)
      .join("; ");

    await this.pool.query(
      `UPDATE monitoring_cases
       SET case_type=$2, severity=$3, trigger_summary=$4,
           trigger_details = jsonb_set(
             COALESCE(trigger_details, '{}'::jsonb),
             '{rules}',
             (SELECT COALESCE(jsonb_agg(rule_code), '[]'::jsonb)
                FROM monitoring_case_triggers WHERE case_id=$1)
           ),
           updated_by=$5, updated_at=now()
       WHERE id=$1`,
      [existing.id, mergedType, mergedSeverity, summary, actorId],
    );

    return this.getCaseWithTriggers(existing.id);
  }

  /** Wrapper aman untuk auto-eval — tidak pernah throw. */
  async safeEvaluateTransfer(transferId: number, user?: AuthedUser) {
    try {
      return await this.evaluateTransfer(transferId, user);
    } catch (e: any) {
      this.logger.error(
        `auto monitoring evaluate failed for transfer ${transferId}: ${e?.message}`,
      );
      return { triggered: false as const, error: true as const };
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Read
  // ───────────────────────────────────────────────────────────────────────────

  private async getCaseWithTriggers(id: number) {
    const { rows } = await this.pool.query(
      `SELECT * FROM monitoring_cases WHERE id=$1`,
      [id],
    );
    const c = rows[0];
    if (!c) throw new NotFoundException("Monitoring case not found");
    const { rows: triggers } = await this.pool.query(
      `SELECT * FROM monitoring_case_triggers WHERE case_id=$1 ORDER BY id`,
      [id],
    );
    return { ...c, triggers };
  }

  async getCase(id: number) {
    const base = await this.getCaseWithTriggers(id);

    // Ringkasan transfer & application jika ada
    let transfer: any = null;
    if (base.transfer_id) {
      const { rows } = await this.pool.query(
        `SELECT id, partner_reference_no, amount, amount_value, amount_currency,
                status, result, transfer_method, transfer_channel,
                beneficiary_account_number, beneficiary_account_name, created_at
         FROM transfers WHERE id=$1`,
        [base.transfer_id],
      );
      transfer = rows[0] ?? null;
    }
    let application: any = null;
    if (base.application_id) {
      const { rows } = await this.pool.query(
        `SELECT a.id, a.type, a.status, r.risk_level, r.risk_score
         FROM applications a
         LEFT JOIN application_risk r ON r.application_id = a.id
         WHERE a.id=$1`,
        [base.application_id],
      );
      application = rows[0] ?? null;
    }

    return { ...base, transfer, application };
  }

  async listCases(query: any) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = ["1=1"];
    const params: any[] = [];

    if (query.status) {
      params.push(query.status);
      where.push(`status = $${params.length}`);
    }
    if (query.case_type) {
      params.push(query.case_type);
      where.push(`case_type = $${params.length}`);
    }
    if (query.report_type) {
      params.push(query.report_type);
      where.push(`report_type = $${params.length}`);
    }
    if (query.due_before) {
      params.push(query.due_before);
      where.push(`due_date <= $${params.length}`);
    }
    if (query.q) {
      params.push(`%${query.q}%`);
      const p = `$${params.length}`;
      where.push(
        `(case_no ILIKE ${p} OR cif_no ILIKE ${p} OR customer_name ILIKE ${p} OR trigger_summary ILIKE ${p})`,
      );
    }

    const whereSql = where.join(" AND ");

    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM monitoring_cases WHERE ${whereSql}`,
      params,
    );
    const total = countRows[0].total;

    params.push(limit);
    params.push(offset);
    const { rows: data } = await this.pool.query(
      `SELECT * FROM monitoring_cases
       WHERE ${whereSql}
       ORDER BY id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { data, page, limit, total };
  }

  async listReports(query: any) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const where: string[] = ["report_status IS NOT NULL"];
    const params: any[] = [];

    if (query.report_status) {
      params.push(query.report_status);
      where.push(`report_status = $${params.length}`);
    }
    if (query.report_type) {
      params.push(query.report_type);
      where.push(`report_type = $${params.length}`);
    }

    const whereSql = where.join(" AND ");
    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM monitoring_cases WHERE ${whereSql}`,
      params,
    );
    const total = countRows[0].total;

    params.push(limit);
    params.push(offset);
    const { rows: data } = await this.pool.query(
      `SELECT * FROM monitoring_cases
       WHERE ${whereSql}
       ORDER BY id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { data, page, limit, total };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Workflow: compliance review
  // ───────────────────────────────────────────────────────────────────────────

  private caseTypeIncludesLtkm(caseType: string): boolean {
    return caseType === "LTKM" || caseType === "BOTH";
  }

  async complianceReview(id: number, dto: ComplianceReviewDto, user: AuthedUser) {
    const { rows } = await this.pool.query(
      `SELECT * FROM monitoring_cases WHERE id=$1`,
      [id],
    );
    const c = rows[0];
    if (!c) throw new NotFoundException("Monitoring case not found");

    if (CLOSED_STATUSES.includes(c.status) && c.status !== "NEED_CLARIFICATION") {
      throw new BadRequestException(
        `Case sudah final (${c.status}), tidak bisa direview ulang`,
      );
    }

    const actorId = resolveUserId(user);
    let status = c.status as string;
    let reportType: string | null = c.report_type;
    let reportStatus: string | null = c.report_status;

    switch (dto.action) {
      case "CLOSE_FALSE_POSITIVE":
        status = "CLOSED_FALSE_POSITIVE";
        break;
      case "NEED_CLARIFICATION":
        status = "NEED_CLARIFICATION";
        break;
      case "ESCALATE_TO_DIRECTOR":
        status = "PENDING_DIRECTOR_REVIEW";
        break;
      case "RECOMMEND_REPORT":
        if (this.caseTypeIncludesLtkm(c.case_type)) {
          status = "PENDING_DIRECTOR_REVIEW";
        } else {
          status = "READY_TO_REPORT";
          reportType = "LTKT";
          reportStatus = "DRAFT";
        }
        break;
      case "READY_TO_REPORT":
        // LTKM tidak boleh langsung ready-to-report tanpa persetujuan Director.
        if (this.caseTypeIncludesLtkm(c.case_type)) {
          throw new BadRequestException(
            "LTKM memerlukan persetujuan Director sebelum READY_TO_REPORT. Gunakan ESCALATE_TO_DIRECTOR / RECOMMEND_REPORT.",
          );
        }
        status = "READY_TO_REPORT";
        reportType = "LTKT";
        reportStatus = "DRAFT";
        break;
    }

    const { rows: upd } = await this.pool.query(
      `UPDATE monitoring_cases
       SET status=$2,
           compliance_status=$3,
           compliance_action=$4,
           compliance_notes=$5,
           compliance_reviewed_by=$6,
           compliance_reviewed_at=now(),
           report_type=$7,
           report_status=$8,
           updated_by=$6,
           updated_at=now()
       WHERE id=$1
       RETURNING *`,
      [
        id,
        status,
        status,
        dto.action,
        dto.notes ?? null,
        actorId,
        reportType,
        reportStatus,
      ],
    );

    await this.audit(actorId, "MONITORING_COMPLIANCE_REVIEW", String(id), c, upd[0]);
    return this.getCaseWithTriggers(id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Workflow: director review
  // ───────────────────────────────────────────────────────────────────────────

  async directorReview(id: number, dto: DirectorReviewDto, user: AuthedUser) {
    const { rows } = await this.pool.query(
      `SELECT * FROM monitoring_cases WHERE id=$1`,
      [id],
    );
    const c = rows[0];
    if (!c) throw new NotFoundException("Monitoring case not found");

    if (c.status !== "PENDING_DIRECTOR_REVIEW") {
      throw new BadRequestException(
        "Hanya case berstatus PENDING_DIRECTOR_REVIEW yang bisa direview Director",
      );
    }

    const actorId = resolveUserId(user);
    let status = c.status as string;
    let reportType: string | null = c.report_type;
    let reportStatus: string | null = c.report_status;

    if (dto.decision === "APPROVED") {
      status = "READY_TO_REPORT";
      reportType = this.caseTypeIncludesLtkm(c.case_type) ? "LTKM" : "LTKT";
      reportStatus = "DRAFT";
    } else if (dto.decision === "REJECTED") {
      status = "DIRECTOR_REJECTED";
    } else {
      // REQUEST_MORE_INFO
      status = "NEED_CLARIFICATION";
    }

    const { rows: upd } = await this.pool.query(
      `UPDATE monitoring_cases
       SET status=$2,
           director_decision=$3,
           director_notes=$4,
           director_reviewed_by=$5,
           director_reviewed_at=now(),
           report_type=$6,
           report_status=$7,
           updated_by=$5,
           updated_at=now()
       WHERE id=$1
       RETURNING *`,
      [
        id,
        status,
        dto.decision,
        dto.notes ?? null,
        actorId,
        reportType,
        reportStatus,
      ],
    );

    await this.audit(actorId, "MONITORING_DIRECTOR_REVIEW", String(id), c, upd[0]);
    return this.getCaseWithTriggers(id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Workflow: report update
  // ───────────────────────────────────────────────────────────────────────────

  async updateReport(id: number, dto: UpdateReportDto, user: AuthedUser) {
    const { rows } = await this.pool.query(
      `SELECT * FROM monitoring_cases WHERE id=$1`,
      [id],
    );
    const c = rows[0];
    if (!c) throw new NotFoundException("Monitoring case not found");

    if (!["READY_TO_REPORT", "REPORTED"].includes(c.status)) {
      throw new BadRequestException(
        "Hanya case READY_TO_REPORT atau REPORTED yang bisa diupdate report-nya",
      );
    }

    const actorId = resolveUserId(user);
    let caseStatus = c.status as string;
    let reportedBy = c.reported_by;
    let reportedAt = c.reported_at;

    if (dto.report_status === "SUBMITTED") {
      caseStatus = "REPORTED";
      reportedBy = actorId;
      reportedAt = dto.reported_at ? new Date(dto.reported_at) : new Date();
    } else if (dto.report_status === "ARCHIVED") {
      caseStatus = "ARCHIVED";
    }

    const { rows: upd } = await this.pool.query(
      `UPDATE monitoring_cases
       SET status=$2,
           report_status=$3,
           report_reference_no=COALESCE($4, report_reference_no),
           report_file_uri=COALESCE($5, report_file_uri),
           reported_by=$6,
           reported_at=$7,
           updated_by=$8,
           updated_at=now()
       WHERE id=$1
       RETURNING *`,
      [
        id,
        caseStatus,
        dto.report_status,
        dto.report_reference_no ?? null,
        dto.report_file_uri ?? null,
        reportedBy,
        reportedAt,
        actorId,
      ],
    );

    await this.audit(actorId, "MONITORING_REPORT_UPDATE", String(id), c, upd[0]);
    return this.getCaseWithTriggers(id);
  }
}
