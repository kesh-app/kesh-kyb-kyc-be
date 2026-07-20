import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { createHash, randomUUID } from 'crypto';
import { resolveUserId } from '../../common/auth.util';
import { UploadsService } from '../uploads/uploads.service';
import { buildCsv, buildXlsx, Sheet } from './report-builders';
import { GenerateReportDto, ListReportsQueryDto } from './dto';

type AuthedUser = { sub?: number | string; id?: number | string; role: string };

// report_type → ordered list of sheet builder keys. KYC/KYB are only reachable
// via KYC_KYB or ALL (no standalone type), matching the enum.
const SHEET_MAP: Record<string, string[]> = {
  ALL: ['kyc', 'kyb', 'ltkt', 'ltkm', 'transfers', 'complaints'],
  KYC_KYB: ['kyc', 'kyb'],
  TRANSFERS: ['transfers'],
  COMPLAINTS: ['complaints'],
  LTKT: ['ltkt'],
  LTKM: ['ltkm'],
};

const MAX_RANGE_DAYS = 31;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @Inject('PG_POOL') private readonly pool: Pool,
    private readonly uploads: UploadsService,
  ) {}

  // ── public API ────────────────────────────────────────────────────────────

  async generate(user: AuthedUser, dto: GenerateReportDto) {
    const start = new Date(dto.period_start);
    const end = new Date(dto.period_end);
    if (end.getTime() < start.getTime()) {
      throw new BadRequestException('period_end must be >= period_start.');
    }
    const rangeDays = (end.getTime() - start.getTime()) / 86_400_000;
    if (rangeDays > MAX_RANGE_DAYS) {
      throw new BadRequestException('Maksimal periode on-demand adalah 31 hari.');
    }

    const sheetKeys = SHEET_MAP[dto.report_type];
    if (dto.format === 'CSV' && sheetKeys.length > 1) {
      throw new BadRequestException(
        'CSV hanya dapat digunakan untuk satu jenis report. Gunakan XLSX untuk ALL.',
      );
    }

    const reportNo = await this.resolveReportNo();
    const inserted = await this.pool.query(
      `INSERT INTO generated_reports
         (report_no, report_type, generation_mode, format, status,
          period_start, period_end, filters, generated_by, generated_at)
       VALUES ($1,$2,'ON_DEMAND',$3,'PENDING',$4,$5,$6,$7,now())
       RETURNING id, report_no, status`,
      [
        reportNo,
        dto.report_type,
        dto.format,
        dto.period_start,
        dto.period_end,
        JSON.stringify(dto.filters ?? {}),
        resolveUserId(user),
      ],
    );
    const row = inserted.rows[0];

    // Fire-and-forget background job. ponytail: in-process async, no queue yet —
    // swap this line for a BullMQ enqueue when a worker exists; process() is the job body.
    setImmediate(() => {
      this.process(row.id, dto).catch((err) =>
        this.logger.error(`Report ${row.id} crashed: ${err?.message ?? err}`),
      );
    });

    return { id: String(row.id), report_no: row.report_no, status: row.status };
  }

  async list(query: ListReportsQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const offset = (page - 1) * limit;

    const params: any[] = [];
    const where: string[] = [];
    const add = (val: any) => {
      params.push(val);
      return `$${params.length}`;
    };
    if (query.report_type) where.push(`report_type = ${add(query.report_type)}`);
    if (query.generation_mode) where.push(`generation_mode = ${add(query.generation_mode)}`);
    if (query.status) where.push(`status = ${add(query.status)}`);
    if (query.date_from) where.push(`created_at >= ${add(query.date_from)}`);
    if (query.date_to) where.push(`created_at <= ${add(query.date_to)}`);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countQ = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM generated_reports ${whereSql}`,
      params,
    );
    const dataQ = await this.pool.query(
      `SELECT id, report_no, report_type, generation_mode, format, status,
              period_start, period_end, cutoff_at, as_of, row_counts,
              file_name, file_size, generated_by, generated_at, completed_at, error_message
       FROM generated_reports ${whereSql}
       ORDER BY created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return { data: dataQ.rows, total: countQ.rows[0].total, page, limit };
  }

  async status(id: number) {
    const q = await this.pool.query(
      `SELECT id, report_no, status, error_message, row_counts, completed_at
       FROM generated_reports WHERE id = $1`,
      [id],
    );
    if (!q.rows[0]) throw new NotFoundException('Report not found');
    return q.rows[0];
  }

  async download(id: number) {
    const q = await this.pool.query(
      `SELECT status, object_key, file_name FROM generated_reports WHERE id = $1`,
      [id],
    );
    const row = q.rows[0];
    if (!row) throw new NotFoundException('Report not found');
    if (row.status !== 'COMPLETED' || !row.object_key) {
      throw new BadRequestException('Report is not ready for download.');
    }
    const expiresIn = 300;
    const url = await this.uploads.getSignedUrl(row.object_key, expiresIn);
    return { download_url: url, expires_in: expiresIn, file_name: row.file_name };
  }

  // ── background job ─────────────────────────────────────────────────────────

  private async process(id: number, dto: GenerateReportDto) {
    await this.pool.query(
      `UPDATE generated_reports SET status='PROCESSING', started_at=now(), updated_at=now() WHERE id=$1`,
      [id],
    );
    try {
      const period: [string, string] = [dto.period_start, dto.period_end];
      const sheets: Sheet[] = [];
      const rowCounts: Record<string, number> = {};
      for (const key of SHEET_MAP[dto.report_type]) {
        const sheet = await this.buildSheet(key, period);
        sheets.push(sheet);
        rowCounts[sheet.name] = sheet.rows.length;
      }

      const ext = dto.format === 'CSV' ? 'csv' : 'xlsx';
      const buf =
        dto.format === 'CSV' ? buildCsv(sheets[0]) : buildXlsx(sheets);
      const checksum = createHash('sha256').update(buf).digest('hex');

      const reportNoQ = await this.pool.query(
        `SELECT report_no FROM generated_reports WHERE id=$1`,
        [id],
      );
      const reportNo = reportNoQ.rows[0].report_no;
      const objectKey = this.buildObjectKey(reportNo, ext);
      const fileName = `${reportNo}.${ext}`;

      const stored = await this.uploads.uploadBuffer(
        buf,
        ext === 'csv' ? 'text/csv' : XLSX_MIME,
        ext,
        objectKey,
      );

      await this.pool.query(
        `UPDATE generated_reports
           SET status='COMPLETED', object_key=$2, file_name=$3, file_size=$4,
               checksum_sha256=$5, row_counts=$6, completed_at=now(), updated_at=now()
         WHERE id=$1`,
        [id, stored.key, fileName, buf.length, checksum, JSON.stringify(rowCounts)],
      );
    } catch (err: any) {
      this.logger.error(`Report ${id} failed: ${err?.message ?? err}`);
      await this.pool.query(
        `UPDATE generated_reports
           SET status='FAILED', error_message=$2, object_key=NULL,
               completed_at=now(), updated_at=now()
         WHERE id=$1`,
        [id, String(err?.message ?? err).slice(0, 2000)],
      );
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private buildObjectKey(reportNo: string, ext: string): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `reports/on-demand/${y}/${m}/${d}/${reportNo}.${ext}`;
  }

  private async resolveReportNo(): Promise<string> {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (let i = 0; i < 5; i++) {
      const candidate = `RPT-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
      const dup = await this.pool.query(
        `SELECT 1 FROM generated_reports WHERE report_no=$1 LIMIT 1`,
        [candidate],
      );
      if ((dup.rowCount ?? 0) === 0) return candidate;
    }
    throw new BadRequestException('Failed to generate report_no, please retry');
  }

  private buildSheet(key: string, period: [string, string]): Promise<Sheet> {
    switch (key) {
      case 'kyc': return this.kycSheet(period);
      case 'kyb': return this.kybSheet(period);
      case 'transfers': return this.transfersSheet(period);
      case 'ltkm': return this.ltkmSheet(period);
      case 'ltkt': return this.ltktSheet(period);
      case 'complaints': return this.complaintsSheet(period);
      default: throw new Error(`Unknown report sheet: ${key}`);
    }
  }

  private yesNo(v: any): string | null {
    if (v === null || v === undefined) return null;
    return v ? 'YES' : 'NO';
  }

  // Screening summary per application — HIT(n) or NO_HIT.
  private readonly watchLateral = `
    LEFT JOIN LATERAL (
      SELECT CASE WHEN count(*) = 0 THEN 'NO_HIT'
                  ELSE 'HIT(' || count(*) || ')' END AS watch_result
      FROM screening_results s WHERE s.application_id = a.id AND s.match_score IS NOT NULL
    ) ws ON true`;

  private async kycSheet([from, to]: [string, string]): Promise<Sheet> {
    const columns = [
      'CIF', 'Nama Pengguna Jasa', 'Jenis Pengguna Jasa', 'Status', 'Risk Level',
      'RBA Score', 'RBA Status', 'EDD Required', 'EDD Status', 'Watchlist Result',
      'Created At', 'Submitted At', 'Approved At', 'Approved By',
    ];
    const q = await this.pool.query(
      `SELECT p.cif_no, p.full_name, a.type, a.status,
              ar.risk_level, ar.rba_score_v01, ar.rba_calculation_status,
              e.edd_required, e.edd_completed, ws.watch_result,
              a.created_at, a.submitted_at, a.decision_at, u.name AS approved_by
       FROM applications a
       JOIN persons p ON p.id = a.person_id
       LEFT JOIN application_risk ar ON ar.application_id = a.id
       LEFT JOIN application_edd e ON e.application_id = a.id
       LEFT JOIN users u ON u.id = a.decision_by
       ${this.watchLateral}
       WHERE a.type = 'INDIVIDUAL' AND a.created_at >= $1 AND a.created_at <= $2
       ORDER BY a.created_at DESC`,
      [from, to],
    );
    const rows = q.rows.map((r) => [
      r.cif_no, r.full_name, r.type, r.status, r.risk_level,
      r.rba_score_v01, r.rba_calculation_status,
      this.yesNo(r.edd_required),
      r.edd_required ? (r.edd_completed ? 'COMPLETED' : 'PENDING') : null,
      r.watch_result, r.created_at, r.submitted_at, r.decision_at, r.approved_by,
    ]);
    return { name: 'KYC', columns, rows };
  }

  private async kybSheet([from, to]: [string, string]): Promise<Sheet> {
    const columns = [
      'CIF', 'Nama Badan Usaha', 'NPWP', 'NIB', 'Bentuk Badan Usaha', 'Bidang Usaha',
      'PIC Name', 'Director Share Percentage', 'Commissioner Share Percentage',
      'Status', 'Risk Level', 'RBA Score', 'RBA Status', 'EDD Required', 'EDD Status',
      'Created At', 'Submitted At', 'Approved At', 'Approved By',
    ];
    const q = await this.pool.query(
      `SELECT b.cif_no, b.legal_name, b.npwp, b.nib, b.legal_form, b.business_activity,
              b.pic_name, b.director_share_percentage, b.commissioner_share_percentage,
              a.status, ar.risk_level, ar.rba_score_v01, ar.rba_calculation_status,
              e.edd_required, e.edd_completed,
              a.created_at, a.submitted_at, a.decision_at, u.name AS approved_by
       FROM applications a
       JOIN business_entities b ON b.id = a.business_id
       LEFT JOIN application_risk ar ON ar.application_id = a.id
       LEFT JOIN application_edd e ON e.application_id = a.id
       LEFT JOIN users u ON u.id = a.decision_by
       WHERE a.type = 'BUSINESS' AND a.created_at >= $1 AND a.created_at <= $2
       ORDER BY a.created_at DESC`,
      [from, to],
    );
    const rows = q.rows.map((r) => [
      r.cif_no, r.legal_name, r.npwp, r.nib, r.legal_form, r.business_activity,
      r.pic_name, r.director_share_percentage, r.commissioner_share_percentage,
      r.status, r.risk_level, r.rba_score_v01, r.rba_calculation_status,
      this.yesNo(r.edd_required),
      r.edd_required ? (r.edd_completed ? 'COMPLETED' : 'PENDING') : null,
      r.created_at, r.submitted_at, r.decision_at, r.approved_by,
    ]);
    return { name: 'KYB', columns, rows };
  }

  private async transfersSheet([from, to]: [string, string]): Promise<Sheet> {
    const columns = [
      'Transfer ID', 'Reference No', 'CIF', 'Sender Name', 'Customer Type', 'Amount',
      'Currency', 'Beneficiary Name', 'Beneficiary Bank', 'Beneficiary Account', 'Purpose',
      'Status', 'Result', 'Compliance Review Status', 'Red Flags', 'Compliance Notes',
      'Compliance Reviewed At', 'Submitted At', 'Supervisor Reviewed At',
      'Finance Reviewed At', 'Final Approved At', 'Completed At', 'Rejected At',
    ];
    const q = await this.pool.query(
      `SELECT t.id, COALESCE(t.reference_no, t.partner_reference_no) AS reference_no,
              COALESCE(p.cif_no, b.cif_no) AS cif_no,
              COALESCE(p.full_name, b.legal_name, t.source_account_name) AS sender_name,
              sa.type AS customer_type, t.amount, t.currency,
              t.beneficiary_account_name, t.beneficiary_bank_name, t.beneficiary_account_number,
              t.transaction_purpose, t.status, t.result,
              cr.status AS cr_status, cr.red_flags, cr.decision_notes AS cr_notes, cr.reviewed_at AS cr_reviewed_at,
              t.submitted_at, t.supervisor_reviewed_at, t.finance_reviewed_at,
              t.approved_at, t.completed_at, t.rejected_at
       FROM transfers t
       LEFT JOIN applications sa ON sa.id = t.sender_application_id
       LEFT JOIN persons p ON p.id = sa.person_id
       LEFT JOIN business_entities b ON b.id = sa.business_id
       LEFT JOIN LATERAL (
         SELECT status, red_flags, decision_notes, reviewed_at
         FROM transfer_compliance_reviews r
         WHERE r.transfer_id = t.id ORDER BY r.created_at DESC LIMIT 1
       ) cr ON true
       WHERE t.created_at >= $1 AND t.created_at <= $2
       ORDER BY t.created_at DESC`,
      [from, to],
    );
    const rows = q.rows.map((r) => [
      r.id, r.reference_no, r.cif_no, r.sender_name, r.customer_type, r.amount, r.currency,
      r.beneficiary_account_name, r.beneficiary_bank_name, r.beneficiary_account_number,
      r.transaction_purpose, r.status, r.result, r.cr_status,
      r.red_flags ? JSON.stringify(r.red_flags) : null, r.cr_notes, r.cr_reviewed_at,
      r.submitted_at, r.supervisor_reviewed_at, r.finance_reviewed_at,
      r.approved_at, r.completed_at, r.rejected_at,
    ]);
    return { name: 'Transfers', columns, rows };
  }

  // Source of truth for LTKT/LTKM = monitoring_cases (case_type). 'BOTH' cases
  // belong to both reports. Transfer/application tables joined for enrichment
  // only (CIF, name, type, reference, amount) — never as the row source.
  private readonly monitoringEnrichment = `
    FROM monitoring_cases mc
    LEFT JOIN transfers t ON t.id = mc.transfer_id
    LEFT JOIN applications a ON a.id = COALESCE(mc.application_id, t.sender_application_id)
    LEFT JOIN persons p ON p.id = a.person_id
    LEFT JOIN business_entities b ON b.id = a.business_id
    LEFT JOIN users u ON u.id = mc.compliance_reviewed_by`;

  private async ltktSheet([from, to]: [string, string]): Promise<Sheet> {
    const columns = [
      'Monitoring Case ID', 'Monitoring Type', 'Status', 'CIF', 'Customer Name', 'Customer Type',
      'Transfer Reference', 'Transaction Date', 'Amount', 'Currency', 'Alert Reason',
      'Review Notes', 'Reviewed By', 'Reviewed At', 'Created At',
    ];
    const q = await this.pool.query(
      `SELECT mc.case_no, mc.case_type, mc.status,
              COALESCE(mc.cif_no, p.cif_no, b.cif_no) AS cif_no,
              COALESCE(mc.customer_name, p.full_name, b.legal_name) AS customer_name,
              a.type AS customer_type,
              COALESCE(t.reference_no, t.partner_reference_no) AS reference_no,
              t.transaction_date, t.amount, t.currency,
              mc.trigger_summary, mc.compliance_notes, u.name AS reviewed_by,
              mc.compliance_reviewed_at, mc.created_at
       ${this.monitoringEnrichment}
       WHERE mc.case_type IN ('LTKT','BOTH') AND mc.created_at >= $1 AND mc.created_at <= $2
       ORDER BY mc.created_at DESC`,
      [from, to],
    );
    const rows = q.rows.map((r) => [
      r.case_no, r.case_type, r.status, r.cif_no, r.customer_name, r.customer_type,
      r.reference_no, r.transaction_date, r.amount, r.currency, r.trigger_summary,
      r.compliance_notes, r.reviewed_by, r.compliance_reviewed_at, r.created_at,
    ]);
    return { name: 'LTKT', columns, rows };
  }

  private async ltkmSheet([from, to]: [string, string]): Promise<Sheet> {
    const columns = [
      'Monitoring Case ID', 'Monitoring Type', 'Status', 'CIF', 'Customer Name', 'Customer Type',
      'Transfer Reference', 'Red Flags / Alert Reason', 'Report Notes', 'Compliance Notes',
      'Reviewed By', 'Reviewed At', 'Created At',
    ];
    const q = await this.pool.query(
      `SELECT mc.case_no, mc.case_type, mc.status,
              COALESCE(mc.cif_no, p.cif_no, b.cif_no) AS cif_no,
              COALESCE(mc.customer_name, p.full_name, b.legal_name) AS customer_name,
              a.type AS customer_type,
              COALESCE(t.reference_no, t.partner_reference_no) AS reference_no,
              mc.trigger_summary, mc.manager_notes, mc.compliance_notes,
              u.name AS reviewed_by, mc.compliance_reviewed_at, mc.created_at
       ${this.monitoringEnrichment}
       WHERE mc.case_type IN ('LTKM','BOTH') AND mc.created_at >= $1 AND mc.created_at <= $2
       ORDER BY mc.created_at DESC`,
      [from, to],
    );
    const rows = q.rows.map((r) => [
      r.case_no, r.case_type, r.status, r.cif_no, r.customer_name, r.customer_type,
      r.reference_no, r.trigger_summary, r.manager_notes, r.compliance_notes,
      r.reviewed_by, r.compliance_reviewed_at, r.created_at,
    ]);
    return { name: 'LTKM', columns, rows };
  }

  private async complaintsSheet([from, to]: [string, string]): Promise<Sheet> {
    const columns = [
      'Complaint No', 'Customer CIF', 'Customer Name', 'Complaint Type', 'Channel', 'Subject',
      'Status', 'Priority', 'Related Transfer Reference', 'Created By', 'Created At',
      'Resolved By', 'Resolved At', 'Resolution Notes', 'Closed At',
    ];
    const q = await this.pool.query(
      `SELECT c.complaint_no, c.customer_cif_no, c.customer_name, c.category, c.channel,
              c.complaint_notes, c.status, c.priority, c.transaction_reference,
              cu.name AS created_by, c.created_at, ru.name AS resolved_by,
              c.resolved_at, c.resolution_notes
       FROM complaints c
       LEFT JOIN users cu ON cu.id = c.created_by
       LEFT JOIN users ru ON ru.id = c.resolved_by
       WHERE c.created_at >= $1 AND c.created_at <= $2
       ORDER BY c.created_at DESC`,
      [from, to],
    );
    const rows = q.rows.map((r) => [
      r.complaint_no, r.customer_cif_no, r.customer_name, r.category, r.channel,
      r.complaint_notes ? String(r.complaint_notes).slice(0, 200) : null,
      r.status, r.priority, r.transaction_reference, r.created_by, r.created_at,
      r.resolved_by, r.resolved_at, r.resolution_notes,
      c_closed(r.status, r.resolved_at),
    ]);
    return { name: 'Complaints', columns, rows };
  }
}

// Complaints has no closed_at column; treat CLOSED status' resolved_at as the close time.
function c_closed(status: any, resolvedAt: any) {
  return status === 'CLOSED' ? resolvedAt : null;
}
