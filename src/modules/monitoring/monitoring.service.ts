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
  ManagerReviewDto,
  StaffReviewDto,
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

// ── Rupiah formatter (used in alert matched_conditions) ──────────────────────
function fmtRp(n: number): string {
  return `Rp${Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

// ── Alert template registry ──────────────────────────────────────────────────
interface AlertTemplate {
  alert_code: string;
  alert_name: string;
  report_type: "LTKT" | "LTKM";
  trigger_criteria: string;
  parameters: string[];
  analysis: string;
  recommendation: string;
  source: string;
}

const MONITORING_ALERT_TEMPLATES: Record<string, AlertTemplate> = {
  // ── LTKM alerts ──
  LTKM_PROFILE_ANOMALY: {
    alert_code: "LTKM_PROFILE_ANOMALY",
    alert_name: "Transaksi Tidak Sesuai Profil Nasabah / Anomaly Transaction",
    report_type: "LTKM",
    trigger_criteria:
      "Transaksi meningkat signifikan dan tidak sesuai profil nasabah.",
    parameters: [
      "Lookback 90 hari",
      "Volume transaksi naik ≥300%",
      "Nilai transaksi > Rp500 juta/hari",
    ],
    analysis:
      "Mismatch antara profil nasabah dan perilaku transaksi merupakan indikator suspicious transaction dan berpotensi placement/mule account activity.",
    recommendation:
      "Lakukan review profil transaksi 90 hari terakhir. Minta klarifikasi sumber dana dan tujuan transaksi kepada nasabah. Pertimbangkan eskalasi ke EDD.",
    source: "internal_aml_alert_matrix",
  },
  LTKM_EDD_REQUIRED: {
    alert_code: "LTKM_EDD_REQUIRED",
    alert_name: "Transaksi Wajib EDD",
    report_type: "LTKM",
    trigger_criteria:
      "Transaksi oleh nasabah/merchant kategori risiko tinggi sehingga wajib EDD.",
    parameters: [
      "PEP/Sanction/Adverse News",
      "Transaksi ≥ Rp500 juta/hari",
      "Rapid movement of funds",
    ],
    analysis:
      "Nasabah high risk wajib EDD untuk memastikan sumber dana, tujuan transaksi, dan underlying activity.",
    recommendation:
      "Lakukan Enhanced Due Diligence (EDD). Verifikasi sumber dana, tujuan transaksi, dan underlying business activity. Pertimbangkan pelaporan LTKM ke PPATK.",
    source: "internal_aml_alert_matrix",
  },
  LTKM_HIGH_RISK_COUNTRY: {
    alert_code: "LTKM_HIGH_RISK_COUNTRY",
    alert_name: "High Risk Country Transaction",
    report_type: "LTKM",
    trigger_criteria: "Transaksi ke/dari negara berisiko tinggi.",
    parameters: [
      "Negara FATF greylist/blacklist",
      "Tax haven country",
      "≥5 transaksi lintas negara/30 hari",
    ],
    analysis:
      "Potensi cross-border laundering dan terrorist financing risk.",
    recommendation:
      "Verifikasi tujuan transaksi lintas negara. Periksa apakah counterpart berada di negara FATF greylist/blacklist. Pertimbangkan pelaporan ke PPATK.",
    source: "internal_aml_alert_matrix",
  },
  LTKM_UNUSUAL_IDENTITY: {
    alert_code: "LTKM_UNUSUAL_IDENTITY",
    alert_name: "Penggunaan Identitas Tidak Wajar",
    report_type: "LTKM",
    trigger_criteria: "Indikasi manipulasi identitas.",
    parameters: [
      "Fake document",
      "Multiple onboarding dengan device yang sama",
    ],
    analysis: "Indikasi synthetic identity dan fraud onboarding.",
    recommendation:
      "Lakukan verifikasi dokumen identitas secara manual. Periksa riwayat onboarding dengan device/IP yang sama. Koordinasikan dengan tim fraud.",
    source: "internal_aml_alert_matrix",
  },
  LTKM_STRUCTURING_SMURFING: {
    alert_code: "LTKM_STRUCTURING_SMURFING",
    alert_name: "Structuring/Smurfing",
    report_type: "LTKM",
    trigger_criteria: "Transaksi dipecah untuk menghindari monitoring.",
    parameters: [
      "≥5 transaksi berulang",
      "Pola nominal serupa",
      "Lookback 7 hari",
    ],
    analysis: "Indikasi layering dan avoidance detection.",
    recommendation:
      "Analisis pola transaksi 7 hari terakhir. Verifikasi apakah ada pola pemecahan nominal untuk menghindari threshold. Pertimbangkan pelaporan LTKM.",
    source: "internal_aml_alert_matrix",
  },
  LTKM_ABNORMAL_QRIS_ACTIVITY: {
    alert_code: "LTKM_ABNORMAL_QRIS_ACTIVITY",
    alert_name: "Abnormal QRIS Activity",
    report_type: "LTKM",
    trigger_criteria: "Aktivitas QRIS tidak sesuai profil usaha.",
    parameters: ["Transaksi kecil repetitive ≥50x/hari"],
    analysis:
      "Potensi misuse of payment channel, nominee merchant, atau layering.",
    recommendation:
      "Review profil merchant dan frekuensi transaksi QRIS. Verifikasi underlying business activity.",
    source: "internal_aml_alert_matrix",
  },
  LTKM_MERCHANT_CATEGORY_MISMATCH: {
    alert_code: "LTKM_MERCHANT_CATEGORY_MISMATCH",
    alert_name: "Merchant Category Mismatch",
    report_type: "LTKM",
    trigger_criteria: "Ketidaksesuaian profil merchant dan pola transaksi.",
    parameters: [
      "MCC mismatch",
      "Lookback 90 hari",
      "Volume transaksi meningkat ≥300%",
      "Dominasi transaksi kategori berisiko tinggi",
      "Transaksi jam abnormal 00.00–04.00",
      "Refund/chargeback >25%",
    ],
    analysis:
      "Potensi nominee merchant atau penyamaran underlying business.",
    recommendation:
      "Verifikasi MCC dan profil merchant. Lakukan site visit jika diperlukan. Periksa pola transaksi abnormal.",
    source: "internal_aml_alert_matrix",
  },
  LTKM_ONLINE_GAMBLING: {
    alert_code: "LTKM_ONLINE_GAMBLING",
    alert_name: "Online Gambling Transaction",
    report_type: "LTKM",
    trigger_criteria: "Pola transaksi mengarah ke perjudian daring.",
    parameters: [
      "Lookback 30 hari",
      "Frekuensi transaksi ≥50 transaksi/hari",
      "Nominal random/repetitive Rp10 ribu–Rp500 ribu",
      "Kode unik",
      "Outgoing ≥80% dari incoming fund",
      "Jam dominan 22.00–04.00",
      "Device/IP terkait multiple account/merchant",
    ],
    analysis:
      "Indikasi penggunaan payment channel untuk judi online, layering, mule account.",
    recommendation:
      "Analisis pola transaksi dan jam aktivitas. Verifikasi identitas counterpart. Pertimbangkan pemblokiran akun dan pelaporan.",
    source: "internal_aml_alert_matrix",
  },
  LTKM_DORMANT_REACTIVATION: {
    alert_code: "LTKM_DORMANT_REACTIVATION",
    alert_name: "Dormant Account Reactivation",
    report_type: "LTKM",
    trigger_criteria:
      "Rekening dormant aktif kembali dengan nominal besar/frekuensi tinggi.",
    parameters: [
      "Dormant days ≥180 hari",
      "Aktivitas transaksi ≥Rp500 juta/hari",
    ],
    analysis: "Potensi nominee account atau rekening penampung.",
    recommendation:
      "Verifikasi identitas pemilik rekening. Lakukan re-KYC jika diperlukan. Review underlying activity.",
    source: "internal_aml_alert_matrix",
  },
  LTKM_RAPID_MOVEMENT_FUNDS: {
    alert_code: "LTKM_RAPID_MOVEMENT_FUNDS",
    alert_name: "Rapid Movement of Funds",
    report_type: "LTKM",
    trigger_criteria:
      "Dana diterima lalu dipindahkan cepat ke banyak rekening.",
    parameters: [
      "Outgoing ≥80% dari incoming fund",
      "Perpindahan dana <1x24 jam",
      "Transfer ke ≥10 rekening berbeda",
      "Lookback 7 hari",
    ],
    analysis: "Indikasi layering/mule account.",
    recommendation:
      "Analisis pola aliran dana. Verifikasi tujuan transfer ke banyak beneficiary. Pertimbangkan pemblokiran sementara dan pelaporan LTKM.",
    source: "internal_aml_alert_matrix",
  },

  // ── LTKT amount-threshold alert (non-cash, wajib lapor by nominal) ──
  LTKT_AMOUNT_500M: {
    alert_code: "LTKT_AMOUNT_500M",
    alert_name: "Transaksi ≥ Rp500 Juta (Kriteria LTKT Nominal)",
    report_type: "LTKT",
    trigger_criteria:
      "Nominal transaksi memenuhi kriteria LTKT internal: Rp500.000.000 atau lebih.",
    parameters: ["Nilai transaksi tunggal ≥ Rp500 juta"],
    analysis:
      "Transaksi bernilai ≥ Rp500 juta wajib dilaporkan sebagai LTKT sesuai ketentuan.",
    recommendation:
      "Verifikasi sumber dana dan tujuan transaksi. Laporkan sebagai LTKT ke PPATK sesuai ketentuan.",
    source: "internal_aml_alert_matrix",
  },

  // ── LTKM manual classification oleh Compliance ──
  LTKM_COMPLIANCE_MARKED: {
    alert_code: "LTKM_COMPLIANCE_MARKED",
    alert_name: "Kandidat LTKM (Ditandai Compliance)",
    report_type: "LTKM",
    trigger_criteria:
      "Compliance menandai transaksi sebagai kandidat LTKM pada review.",
    parameters: ["Red flags & catatan dari compliance review"],
    analysis:
      "Transaksi ditandai manual sebagai mencurigakan oleh ComplianceLead.",
    recommendation:
      "Lanjutkan analisis dan pertimbangkan pelaporan LTKM ke PPATK.",
    source: "compliance_review",
  },

  // ── LTKT alerts ──
  LTKT_CASH_DEPOSIT_PROFILE_MISMATCH: {
    alert_code: "LTKT_CASH_DEPOSIT_PROFILE_MISMATCH",
    alert_name: "Setoran Tunai Tidak Sesuai Profil Nasabah",
    report_type: "LTKT",
    trigger_criteria:
      "Setoran tunai nominal signifikan tidak sesuai profil/histori.",
    parameters: [
      "Lookback 90 hari",
      "Kenaikan transaksi ≥300%",
      "Setoran tunai ≥Rp500 juta/hari",
    ],
    analysis: "Potensi placement dana hasil tindak pidana.",
    recommendation:
      "Verifikasi sumber dana tunai. Lakukan CDD/EDD terhadap nasabah. Laporkan sebagai LTKT ke PPATK sesuai ketentuan.",
    source: "internal_aml_alert_matrix",
  },
  LTKT_CASH_DEPOSIT_STRUCTURING: {
    alert_code: "LTKT_CASH_DEPOSIT_STRUCTURING",
    alert_name: "Frequent Cash Deposit Structuring",
    report_type: "LTKT",
    trigger_criteria:
      "Setoran tunai kecil berulang untuk menghindari threshold.",
    parameters: [
      "Lookback 7 hari",
      "≥5 transaksi tunai/hari",
      "Akumulasi ≥Rp500 juta",
    ],
    analysis: "Indikasi structuring/smurfing transaksi tunai.",
    recommendation:
      "Analisis pola setoran tunai 7 hari terakhir. Verifikasi underlying activity. Laporkan sebagai LTKT dan pertimbangkan laporan LTKM jika ada indikasi pencucian.",
    source: "internal_aml_alert_matrix",
  },
  LTKT_ABNORMAL_CASH_OUT: {
    alert_code: "LTKT_ABNORMAL_CASH_OUT",
    alert_name: "Abnormal Cash-Out Transaction",
    report_type: "LTKT",
    trigger_criteria:
      "Dana masuk lalu segera ditarik tunai tanpa underlying jelas.",
    parameters: [
      "Penarikan ≥80% dana masuk",
      "≤1 hari sejak incoming transfer",
      "Nominal ≥Rp500 juta",
    ],
    analysis: "Indikasi layering untuk memutus jejak transaksi.",
    recommendation:
      "Verifikasi tujuan penarikan tunai besar. Analisis hubungan incoming-outgoing fund. Pertimbangkan pelaporan LTKT.",
    source: "internal_aml_alert_matrix",
  },
  LTKT_DORMANT_CASH_ACTIVITY: {
    alert_code: "LTKT_DORMANT_CASH_ACTIVITY",
    alert_name: "Dormant Cash Activity",
    report_type: "LTKT",
    trigger_criteria:
      "Rekening dormant aktif dan melakukan transaksi tunai besar.",
    parameters: [
      "Dormant days ≥180 hari",
      "Aktivitas tunai ≥Rp500 juta/hari",
    ],
    analysis:
      "Potensi nominee account/account takeover/penampungan dana.",
    recommendation:
      "Lakukan re-KYC dan verifikasi identitas. Bekukan akun sementara jika diperlukan. Laporkan sebagai LTKT.",
    source: "internal_aml_alert_matrix",
  },
  LTKT_FREQUENT_CASH_ACTIVITY: {
    alert_code: "LTKT_FREQUENT_CASH_ACTIVITY",
    alert_name: "Frequent Cash Activity",
    report_type: "LTKT",
    trigger_criteria:
      "Frekuensi transaksi tunai tinggi dan nominal besar tidak sesuai kebiasaan.",
    parameters: [
      "≥10 transaksi tunai/3 hari",
      "Total nominal ≥Rp1 miliar",
    ],
    analysis:
      "Red flag AML-CFT karena risiko tinggi pada transaksi tunai.",
    recommendation:
      "Analisis frekuensi dan nominal transaksi tunai. Verifikasi underlying activity. Laporkan sebagai LTKT.",
    source: "internal_aml_alert_matrix",
  },
};

// ── Rule code → alert code mapping ──────────────────────────────────────────
const RULE_TO_ALERT_CODE: Record<string, string> = {
  LTKT_CASH_SINGLE_500M: "LTKT_CASH_DEPOSIT_PROFILE_MISMATCH",
  LTKT_CASH_AGGREGATE_DAILY_500M: "LTKT_CASH_DEPOSIT_STRUCTURING",
  LTKM_HIGH_RISK_CUSTOMER: "LTKM_EDD_REQUIRED",
  LTKM_PEP_RELATED: "LTKM_EDD_REQUIRED",
  LTKM_SANCTION_RELATED: "LTKM_EDD_REQUIRED",
  LTKM_EDD_RECOMMEND_LTKM: "LTKM_EDD_REQUIRED",
  LTKM_STRUCTURING_DAILY: "LTKM_STRUCTURING_SMURFING",
  LTKM_MANY_BENEFICIARIES_DAILY: "LTKM_RAPID_MOVEMENT_FUNDS",
  LTKM_HIGH_VALUE_TRANSFER: "LTKM_PROFILE_ANOMALY",
};

const SEVERITY_RANK: Record<Severity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

// Status yang dianggap "sudah selesai" → tidak boleh di-dedup/append lagi.
const CLOSED_STATUSES = [
  "CLOSED_FALSE_POSITIVE",
  "MANAGER_REJECTED",
  "REPORTED",
  "ARCHIVED",
  // legacy (deprecated)
  "COMPLIANCE_REJECTED",
  "DIRECTOR_REJECTED",
];

// Status yang relevan untuk tahap pertama review (approval pertama oleh ComplianceLead).
const STAFF_RELEVANT_STATUSES = [
  "DETECTED",
  "PENDING_COMPLIANCE_STAFF_REVIEW",
  "NEED_CLARIFICATION",
];

// Label UI (Bahasa Indonesia) untuk status monitoring. Monitoring dimiliki tim
// Compliance sepenuhnya — TIDAK ADA keterlibatan Operation Supervisor. FE harus
// memakai status_label ini alih-alih menebak label dari peta status generik
// (yang keliru menampilkan "Menunggu Review Operation Supervisor").
const STATUS_LABELS: Record<string, string> = {
  // flow baru
  DETECTED: "Menunggu Review Compliance",
  PENDING_COMPLIANCE_STAFF_REVIEW: "Menunggu Review Compliance",
  STAFF_REVIEWED: "Sudah Direview Compliance",
  PENDING_COMPLIANCE_MANAGER_REVIEW: "Menunggu Approval Lead Compliance",
  MANAGER_APPROVED: "Disetujui Lead Compliance",
  MANAGER_REJECTED: "Ditolak Lead Compliance",
  NEED_CLARIFICATION: "Menunggu Klarifikasi Compliance",
  READY_TO_REPORT: "Siap Dilaporkan",
  REPORTED: "Sudah Dilaporkan",
  CLOSED_FALSE_POSITIVE: "Ditutup (False Positive)",
  ARCHIVED: "Diarsipkan",
  // status lama (deprecated) → tetap dipetakan ke label compliance-owned
  UNDER_COMPLIANCE_REVIEW: "Menunggu Review Compliance",
  COMPLIANCE_APPROVED: "Sudah Direview Compliance",
  COMPLIANCE_REJECTED: "Ditolak Lead Compliance",
  PENDING_DIRECTOR_REVIEW: "Menunggu Approval Lead Compliance",
  DIRECTOR_APPROVED: "Disetujui Lead Compliance",
  DIRECTOR_REJECTED: "Ditolak Lead Compliance",
};

function statusLabel(status: string | null | undefined): string {
  return STATUS_LABELS[String(status ?? "")] ?? String(status ?? "");
}

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
  "LTKM_COMPLIANCE_MARKED",
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

  // ── Build structured alert information from a trigger + transfer context ──

  private buildAlertInfo(
    trigger: EvalTrigger,
    ctx: any,
  ): {
    alert_code: string;
    alert_name: string;
    alert_information: Record<string, any>;
  } {
    const alertCode =
      RULE_TO_ALERT_CODE[trigger.rule_code] ?? trigger.rule_code;
    const template = MONITORING_ALERT_TEMPLATES[alertCode];

    const matched_conditions: string[] = [];
    const limitations: string[] = [];
    const evidence: Record<string, any> = {};

    if (ctx) {
      if (ctx.cif_no) evidence.cif_no = ctx.cif_no;
      if (ctx.application_id) evidence.application_id = Number(ctx.application_id);
      if (ctx.txn_at)
        evidence.transaction_date = new Date(ctx.txn_at)
          .toISOString()
          .split("T")[0];
    }
    if (trigger.amount != null) evidence.amount = trigger.amount;

    const d = trigger.details ?? {};

    switch (trigger.rule_code) {
      case "LTKT_CASH_SINGLE_500M":
        matched_conditions.push(
          `Transaksi tunai tunggal ${fmtRp(trigger.amount ?? 0)}`,
          `Melebihi threshold ${fmtRp(CASH_THRESHOLD)}`,
        );
        if (ctx?.id) {
          evidence.transfer_id = Number(ctx.id);
          evidence.transaction_ids = [Number(ctx.id)];
        }
        evidence.lookback_days = 1;
        limitations.push(
          "Lookback 90 hari tidak dihitung (data riwayat tidak diambil)",
          "Kenaikan volume transaksi ≥300% tidak dibandingkan",
        );
        break;

      case "LTKT_CASH_AGGREGATE_DAILY_500M":
        matched_conditions.push(
          `Total tunai harian ${fmtRp(d.cash_total ?? 0)}`,
          `Jumlah transaksi tunai ${d.cash_count ?? 0} dalam 1 hari`,
          `Melebihi threshold ${fmtRp(CASH_THRESHOLD)}`,
        );
        evidence.total_amount = d.cash_total;
        evidence.transaction_count = d.cash_count;
        evidence.lookback_days = 1;
        limitations.push(
          "Lookback 7 hari lintas hari belum dihitung (hanya 1 hari kalender)",
        );
        break;

      case "LTKM_HIGH_RISK_CUSTOMER":
        matched_conditions.push("Nasabah risk_level HIGH");
        evidence.risk_level = "HIGH";
        break;

      case "LTKM_PEP_RELATED":
        matched_conditions.push(
          `Nasabah terkait PEP: ${(d.risk_factors ?? []).join(", ")}`,
        );
        evidence.risk_factors = d.risk_factors;
        break;

      case "LTKM_SANCTION_RELATED":
        matched_conditions.push(
          `Nasabah terkait DTTOT/PPPSPM: ${(d.risk_factors ?? []).join(", ")}`,
        );
        evidence.risk_factors = d.risk_factors;
        break;

      case "LTKM_EDD_RECOMMEND_LTKM":
        matched_conditions.push("EDD merekomendasikan pelaporan LTKM");
        if ((d.officer_recommendations ?? []).length > 0)
          matched_conditions.push(
            `Rekomendasi EDD: ${d.officer_recommendations.join(", ")}`,
          );
        break;

      case "LTKM_STRUCTURING_DAILY":
        matched_conditions.push(
          `Total harian ${fmtRp(d.daily_total ?? 0)}`,
          `Jumlah transaksi ${d.transaction_count ?? 0} dalam 1 hari`,
          `Semua nominal di bawah threshold ${fmtRp(CASH_THRESHOLD)}`,
        );
        evidence.total_amount = d.daily_total;
        evidence.transaction_count = d.transaction_count;
        evidence.lookback_days = 1;
        limitations.push(
          "Lookback 7 hari lintas hari belum dihitung (hanya 1 hari kalender)",
          "Pola nominal serupa belum dianalisis",
        );
        break;

      case "LTKM_MANY_BENEFICIARIES_DAILY":
        matched_conditions.push(
          `Jumlah beneficiary unik ${d.distinct_beneficiaries ?? 0} dalam 1 hari`,
          `Melebihi threshold ${MANY_BENEFICIARIES_THRESHOLD} rekening tujuan berbeda`,
        );
        evidence.distinct_beneficiaries = d.distinct_beneficiaries;
        evidence.lookback_days = 1;
        limitations.push(
          "Incoming fund data belum tersedia, outgoing ratio tidak dihitung",
          "Perpindahan dana <24 jam belum diverifikasi",
          `Threshold yang terdeteksi: ≥${MANY_BENEFICIARIES_THRESHOLD} rekening/hari (template: ≥10 rekening/7 hari)`,
        );
        break;

      case "LTKM_HIGH_VALUE_TRANSFER":
        matched_conditions.push(
          `Nilai transaksi ${fmtRp(trigger.amount ?? 0)} (supporting alert)`,
          `Melebihi threshold ${fmtRp(HIGH_VALUE_THRESHOLD)}`,
        );
        if (ctx?.id) evidence.transfer_id = Number(ctx.id);
        limitations.push(
          "Lookback 90 hari tidak dihitung",
          "Volume transaksi ≥300% increase tidak dihitung",
          "Alert ini bersifat supporting, tidak mengklasifikasikan kasus secara mandiri",
        );
        break;

      default:
        matched_conditions.push(trigger.rule_name);
        break;
    }

    const alert_information: Record<string, any> = {
      report_type: template?.report_type ?? trigger.trigger_type,
      trigger_criteria: template?.trigger_criteria ?? trigger.rule_name,
      parameters: template?.parameters ?? [],
      analysis: template?.analysis ?? "",
      recommendation: template?.recommendation ?? "",
      matched_conditions,
      evidence,
      supported_by_system: matched_conditions.length > 0,
      limitations,
      source: template?.source ?? "internal_aml_alert_matrix",
    };

    return {
      alert_code: alertCode,
      alert_name: template?.alert_name ?? trigger.rule_name,
      alert_information,
    };
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

    // ── LTKT: single transaksi ≥ 500M (threshold-based, wajib lapor) ──
    // LTKT internal berbasis NOMINAL, bukan hanya tunai: setiap transaksi
    // ≥ Rp500.000.000 wajib terdeteksi. Transaksi tunai memakai rule spesifik
    // (profil setoran tunai); non-tunai memakai rule amount generik.
    if (amount >= CASH_THRESHOLD) {
      if (cashCurrent) {
        triggers.push({
          trigger_type: "LTKT",
          rule_code: "LTKT_CASH_SINGLE_500M",
          rule_name: "Transaksi tunai tunggal ≥ Rp500.000.000",
          severity: "HIGH",
          amount,
          details: { amount, threshold: CASH_THRESHOLD },
        });
      } else {
        triggers.push({
          trigger_type: "LTKT",
          rule_code: "LTKT_AMOUNT_500M",
          rule_name:
            "Nominal transaksi memenuhi kriteria LTKT internal: Rp500.000.000 atau lebih.",
          severity: "HIGH",
          amount,
          details: { amount, threshold: CASH_THRESHOLD },
        });
      }
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
    return this.openOrAppendCase(transferId, triggers, ctx, user);
  }

  /**
   * Buat case baru atau append trigger ke case aktif (dedup per transfer_id).
   * Dipakai oleh rule engine (evaluateTransfer) maupun klasifikasi manual
   * (markLtkmCandidate). Idempoten: rule_code yang sama tidak diduplikasi.
   */
  private async openOrAppendCase(
    transferId: number,
    triggers: EvalTrigger[],
    ctx: any,
    user?: AuthedUser,
  ) {
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
      return this.appendTriggersToCase(existing, triggers, actorId, ctx);
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

    await this.insertTriggers(created.id, triggers, ctx);
    await this.audit(actorId, "MONITORING_CASE_DETECTED", String(created.id), null, created);

    return this.getCaseWithTriggers(created.id);
  }

  private async insertTriggers(
    caseId: number,
    triggers: EvalTrigger[],
    ctx?: any,
  ) {
    for (const t of triggers) {
      const { alert_code, alert_name, alert_information } =
        this.buildAlertInfo(t, ctx ?? null);
      await this.pool.query(
        `INSERT INTO monitoring_case_triggers
           (case_id, trigger_type, rule_code, rule_name, severity, score, amount, details,
            alert_code, alert_name, alert_information)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          caseId,
          t.trigger_type,
          t.rule_code,
          t.rule_name,
          t.severity,
          t.score ?? null,
          t.amount ?? null,
          JSON.stringify(t.details ?? {}),
          alert_code,
          alert_name,
          JSON.stringify(alert_information),
        ],
      );
    }
  }

  private async appendTriggersToCase(
    existing: any,
    triggers: EvalTrigger[],
    actorId: number | string | null,
    ctx?: any,
  ) {
    // Trigger yang sudah ada (hindari duplikat rule_code)
    const { rows: existTrig } = await this.pool.query(
      `SELECT rule_code FROM monitoring_case_triggers WHERE case_id=$1`,
      [existing.id],
    );
    const existingCodes = new Set(existTrig.map((r) => r.rule_code));
    const newTriggers = triggers.filter((t) => !existingCodes.has(t.rule_code));

    if (newTriggers.length > 0) {
      await this.insertTriggers(existing.id, newTriggers, ctx);
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

  /**
   * Klasifikasi manual LTKM oleh Compliance (aksi MARK_LTKM_CANDIDATE).
   * Buat case LTKM baru bila belum ada, atau append ke case aktif — jika case
   * LTKT sudah ada untuk transfer ini maka case_type menjadi BOTH. Idempoten.
   */
  async markLtkmCandidate(
    transferId: number,
    opts: { redFlags?: string[]; notes?: string | null } = {},
    user?: AuthedUser,
  ) {
    const ctx = await this.loadTransferContext(transferId);
    if (!ctx) throw new NotFoundException("Transfer not found");

    const trigger: EvalTrigger = {
      trigger_type: "LTKM",
      rule_code: "LTKM_COMPLIANCE_MARKED",
      rule_name: "Ditandai sebagai kandidat LTKM oleh Compliance",
      severity: "HIGH",
      amount: Number(ctx.amount ?? 0) || null,
      details: {
        red_flags: opts.redFlags ?? [],
        compliance_notes: opts.notes ?? null,
        source: "COMPLIANCE_REVIEW",
      },
    };

    return this.openOrAppendCase(transferId, [trigger], ctx, user);
  }

  /** Wrapper aman — tidak pernah menggagalkan compliance review. */
  async safeMarkLtkmCandidate(
    transferId: number,
    opts: { redFlags?: string[]; notes?: string | null } = {},
    user?: AuthedUser,
  ) {
    try {
      return await this.markLtkmCandidate(transferId, opts, user);
    } catch (e: any) {
      this.logger.error(
        `mark LTKM candidate failed for transfer ${transferId}: ${e?.message}`,
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
    return { ...c, status_label: statusLabel(c.status), triggers };
  }

  async getCase(id: number, user?: AuthedUser) {
    const base = await this.getCaseWithTriggers(id);

    // Ringkasan transfer & application jika ada
    let transfer: any = null;
    if (base.transfer_id) {
      const { rows } = await this.pool.query(
        `SELECT t.id, t.partner_reference_no, t.amount, t.amount_value, t.amount_currency,
                t.status, t.result, t.transfer_method, t.transfer_channel,
                t.beneficiary_account_number, t.beneficiary_account_name, t.created_at,
                t.source_of_funds, t.transaction_purpose,
                COALESCE(p.full_name, b.legal_name) AS sender_name,
                COALESCE(p.cif_no, b.cif_no)       AS sender_cif_no
         FROM transfers t
         LEFT JOIN applications a ON a.id = t.sender_application_id
         LEFT JOIN persons p ON p.id = a.person_id
         LEFT JOIN business_entities b ON b.id = a.business_id
         WHERE t.id=$1`,
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

  async listCases(query: any, user?: AuthedUser) {
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
      `SELECT mc.*,
         COALESCE(
           (SELECT array_agg(DISTINCT t.alert_name ORDER BY t.alert_name)
            FROM monitoring_case_triggers t
            WHERE t.case_id = mc.id AND t.alert_name IS NOT NULL),
           ARRAY[]::text[]
         ) AS alert_names,
         (SELECT COUNT(*)::int
          FROM monitoring_case_triggers t
          WHERE t.case_id = mc.id AND t.alert_code IS NOT NULL) AS alert_count
       FROM monitoring_cases mc
       WHERE ${whereSql}
       ORDER BY mc.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      data: data.map((r) => ({ ...r, status_label: statusLabel(r.status) })),
      page,
      limit,
      total,
    };
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
  // Workflow: two-step internal compliance review (keduanya oleh ComplianceLead)
  //   1) staffReview   — approval pertama (ComplianceLead)
  //   2) managerReview  — approval kedua  (ComplianceLead / Compliance Manager)
  // ───────────────────────────────────────────────────────────────────────────

  private caseTypeIncludesLtkm(caseType: string): boolean {
    return caseType === "LTKM" || caseType === "BOTH";
  }

  // Status yang boleh menerima staff review (approval pertama).
  private canStaffReview(status: string): boolean {
    return STAFF_RELEVANT_STATUSES.includes(status);
  }

  // ── Approval pertama: ComplianceLead ─────────────────────────────────────
  async staffReview(id: number, dto: StaffReviewDto, user: AuthedUser) {
    const { rows } = await this.pool.query(
      `SELECT * FROM monitoring_cases WHERE id=$1`,
      [id],
    );
    const c = rows[0];
    if (!c) throw new NotFoundException("Monitoring case not found");

    if (!this.canStaffReview(c.status)) {
      throw new BadRequestException(
        `Case berstatus ${c.status} tidak dapat direview pada tahap pertama ` +
          `(hanya ${STAFF_RELEVANT_STATUSES.join(", ")})`,
      );
    }

    // Semua aksi staff wajib disertai notes non-kosong (jejak analisis awal).
    if (!(dto.notes && dto.notes.trim().length > 0)) {
      throw new BadRequestException(
        `notes wajib diisi untuk aksi ${dto.action}`,
      );
    }

    const actorId = resolveUserId(user);
    let status = c.status as string;

    switch (dto.action) {
      case "ESCALATE_TO_MANAGER":
        status = "PENDING_COMPLIANCE_MANAGER_REVIEW";
        break;
      case "RECOMMEND_CLOSE_FALSE_POSITIVE":
        // Rekomendasi staff untuk menutup — keputusan akhir tetap di Manager.
        status = "PENDING_COMPLIANCE_MANAGER_REVIEW";
        break;
      case "REQUEST_CLARIFICATION":
        status = "NEED_CLARIFICATION";
        break;
    }

    const { rows: upd } = await this.pool.query(
      `UPDATE monitoring_cases
       SET status=$2,
           staff_action=$3,
           staff_notes=$4,
           staff_reviewed_by=$5,
           staff_reviewed_at=now(),
           updated_by=$5,
           updated_at=now()
       WHERE id=$1
       RETURNING *`,
      [id, status, dto.action, dto.notes ?? null, actorId],
    );

    await this.audit(actorId, "MONITORING_STAFF_REVIEW", String(id), c, upd[0]);
    return this.getCaseWithTriggers(id);
  }

  // ── Approval kedua: ComplianceLead / Compliance Manager ────────────────────
  async managerReview(id: number, dto: ManagerReviewDto, user: AuthedUser) {
    const { rows } = await this.pool.query(
      `SELECT * FROM monitoring_cases WHERE id=$1`,
      [id],
    );
    const c = rows[0];
    if (!c) throw new NotFoundException("Monitoring case not found");

    if (c.status !== "PENDING_COMPLIANCE_MANAGER_REVIEW") {
      throw new BadRequestException(
        "Hanya case berstatus PENDING_COMPLIANCE_MANAGER_REVIEW yang bisa direview Compliance Manager. " +
          "Case harus melewati staff review terlebih dahulu.",
      );
    }

    // Defense-in-depth: PENDING_COMPLIANCE_MANAGER_REVIEW hanya sah bila sudah
    // melalui staff review yang lengkap. Tolak case malformed.
    if (!c.staff_reviewed_by || !c.staff_reviewed_at || !c.staff_action) {
      throw new BadRequestException(
        "Case belum melalui staff review yang lengkap (staff_reviewed_by/at/action wajib terisi)",
      );
    }

    const actorId = resolveUserId(user);
    let status = c.status as string;
    let reportType: string | null = c.report_type;
    let reportStatus: string | null = c.report_status;

    switch (dto.action) {
      case "APPROVE_REPORT":
        status = "READY_TO_REPORT";
        reportType = this.caseTypeIncludesLtkm(c.case_type) ? "LTKM" : "LTKT";
        reportStatus = "DRAFT";
        break;
      case "CLOSE_FALSE_POSITIVE":
        status = "CLOSED_FALSE_POSITIVE";
        break;
      case "REJECT":
        status = "MANAGER_REJECTED";
        break;
      case "REQUEST_CLARIFICATION":
        status = "NEED_CLARIFICATION";
        break;
    }

    const { rows: upd } = await this.pool.query(
      `UPDATE monitoring_cases
       SET status=$2,
           manager_action=$3,
           manager_notes=$4,
           manager_reviewed_by=$5,
           manager_reviewed_at=now(),
           report_type=$6,
           report_status=$7,
           updated_by=$5,
           updated_at=now()
       WHERE id=$1
       RETURNING *`,
      [
        id,
        status,
        dto.action,
        dto.notes ?? null,
        actorId,
        reportType,
        reportStatus,
      ],
    );

    await this.audit(actorId, "MONITORING_MANAGER_REVIEW", String(id), c, upd[0]);
    return this.getCaseWithTriggers(id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Legacy aliases (deprecated) — memetakan endpoint lama ke flow baru agar FE
  // lama tidak langsung rusak saat rilis. Hapus setelah FE migrasi penuh.
  //   compliance-review → staff-review
  //   director-review    → manager-review
  // ───────────────────────────────────────────────────────────────────────────

  async complianceReview(id: number, dto: ComplianceReviewDto, user: AuthedUser) {
    const map: Record<string, StaffReviewDto["action"]> = {
      ESCALATE_TO_DIRECTOR: "ESCALATE_TO_MANAGER",
      RECOMMEND_REPORT: "ESCALATE_TO_MANAGER",
      READY_TO_REPORT: "ESCALATE_TO_MANAGER",
      NEED_CLARIFICATION: "REQUEST_CLARIFICATION",
      CLOSE_FALSE_POSITIVE: "RECOMMEND_CLOSE_FALSE_POSITIVE",
    };
    const action = map[dto.action];
    if (!action) {
      throw new BadRequestException(
        `Aksi ${dto.action} tidak lagi didukung. Gunakan endpoint staff-review.`,
      );
    }
    return this.staffReview(id, { action, notes: dto.notes }, user);
  }

  async directorReview(id: number, dto: DirectorReviewDto, user: AuthedUser) {
    const map: Record<string, ManagerReviewDto["action"]> = {
      APPROVED: "APPROVE_REPORT",
      REJECTED: "REJECT",
      REQUEST_MORE_INFO: "REQUEST_CLARIFICATION",
    };
    const action = map[dto.decision];
    if (!action) {
      throw new BadRequestException(
        `Keputusan ${dto.decision} tidak lagi didukung. Gunakan endpoint manager-review.`,
      );
    }
    return this.managerReview(id, { action, notes: dto.notes }, user);
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
