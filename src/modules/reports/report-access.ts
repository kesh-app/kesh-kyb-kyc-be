import { REPORT_TYPES } from './dto';

/**
 * Siapa boleh menyentuh jenis report apa. Report Center dibagi per divisi:
 * pengaduan, finance, dan compliance. Satu tabel ini jadi sumber kebenaran
 * untuk keempat endpoint (generate / list / status / download) supaya tidak ada
 * endpoint yang ketinggalan saat matriks berubah.
 */

/** Boleh semua jenis report. RolesGuard sudah meloloskan SystemAdmin/Director. */
const FULL_ACCESS_ROLES: readonly string[] = ['SystemAdmin', 'Director', 'ComplianceLead'];

/** Read-only: boleh melihat & mengunduh semua, tidak boleh generate. */
const READ_ONLY_ROLES: readonly string[] = ['Auditor'];

/** Divisi non-compliance hanya melihat jenis report miliknya sendiri. */
const ROLE_REPORT_TYPES: Readonly<Record<string, readonly string[]>> = {
  ComplaintHandling: ['COMPLAINTS'],
  OperationSupervisor: ['COMPLAINTS'],
  FinanceStaff: ['TRANSFERS'],
  FinanceManager: ['TRANSFERS'],
};

/**
 * Jenis report yang boleh dilihat/diunduh role ini. Array kosong = tidak punya
 * akses Report Center sama sekali.
 */
export function allowedReportTypes(role: string): readonly string[] {
  if (FULL_ACCESS_ROLES.includes(role) || READ_ONLY_ROLES.includes(role)) {
    return REPORT_TYPES;
  }
  return ROLE_REPORT_TYPES[role] ?? [];
}

export function canReadReports(role: string): boolean {
  return allowedReportTypes(role).length > 0;
}

/**
 * Auditor tetap read-only sesuai kebijakan yang berlaku: boleh list & download,
 * tidak boleh generate.
 */
export function canGenerateReports(role: string): boolean {
  return !READ_ONLY_ROLES.includes(role) && canReadReports(role);
}

export function canAccessReportType(role: string, reportType: string): boolean {
  return allowedReportTypes(role).includes(reportType);
}

/**
 * 'ALL' menggabungkan seluruh sheet lintas divisi, jadi hanya role ber-akses
 * penuh yang boleh membuatnya. Auditor bisa mengunduh ALL yang sudah ada
 * (lewat canAccessReportType) tapi tidak bisa membuatnya — dia read-only.
 */
export function canGenerateReportType(role: string, reportType: string): boolean {
  return canGenerateReports(role) && canAccessReportType(role, reportType);
}
