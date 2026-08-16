import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export const COMPLAINT_LEVELS = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'] as const;

export const LEVEL_3_RISK_CATEGORIES = [
  'FRAUD_SECURITY',
  'LEGAL_RISK',
  'REPUTATION_RISK',
  'COMPLIANCE_RISK',
  'FINANCIAL_IMPACT',
] as const;

export const COMPLAINT_STATUSES = [
  'OPEN',
  'WAITING_CUSTOMER_DATA',
  'OPERATION_INVESTIGATION',
  'WAITING_BANK_CONFIRMATION',
  // Alur berbasis complaint_level (migration 0070)
  'COO_REVIEW',
  'FINANCE_STAFF_REVIEW',
  'FINANCE_MANAGER_REVIEW',
  'COMPLIANCE_REVIEW',
  'COMPLIANCE_HOLD',
  'COMPLAINT_HANDLING_FINALIZATION',
  // Legacy — tetap diterima agar tiket lama bisa difilter & diselesaikan
  'AML_REVIEW',
  'AML_HOLD',
  'FINANCE_REVIEW',
  'REFUND_PROCESS',
  'REFUNDED',
  'RESOLVED',
  'CLOSED',
  'REJECTED',
] as const;

export class CreateComplaintDto {
  @Type(() => Number) @IsInt() @Min(1)
  customer_application_id!: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  transfer_id?: number;

  @IsString() @IsNotEmpty() @MaxLength(100)
  transaction_reference!: string;

  @IsOptional() @IsIn(['TRANSFER', 'KYC_DATA', 'DOCUMENT', 'SERVICE', 'OTHER'])
  category?: string;

  @IsOptional() @IsIn(['WALK_IN', 'WHATSAPP', 'EMAIL', 'PHONE', 'OTHER'])
  channel?: string;

  @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  priority?: string;

  @IsIn(COMPLAINT_LEVELS as any)
  complaint_level!: string;

  // Wajib hanya untuk LEVEL_3; untuk level lain diabaikan (disimpan NULL).
  @ValidateIf((o) => o.complaint_level === 'LEVEL_3')
  @IsIn(LEVEL_3_RISK_CATEGORIES as any)
  level_3_risk_category?: string;

  @IsString() @IsNotEmpty() @MinLength(10) @MaxLength(5000)
  complaint_notes!: string;
}

export class UpdateComplaintDto {
  @IsOptional() @IsIn(['TRANSFER', 'KYC_DATA', 'DOCUMENT', 'SERVICE', 'OTHER'])
  category?: string;

  @IsOptional() @IsIn(['WALK_IN', 'WHATSAPP', 'EMAIL', 'PHONE', 'OTHER'])
  channel?: string;

  @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  priority?: string;

  @IsOptional() @IsIn(COMPLAINT_LEVELS as any)
  complaint_level?: string;

  @ValidateIf((o) => o.complaint_level === 'LEVEL_3')
  @IsIn(LEVEL_3_RISK_CATEGORIES as any)
  level_3_risk_category?: string;

  @IsOptional() @IsString() @MinLength(10) @MaxLength(5000)
  complaint_notes?: string;

  @IsOptional() @IsString() @MaxLength(5000)
  customer_communication_notes?: string;

  // `status` sengaja TIDAK ada di sini. Perpindahan tahap hanya boleh lewat
  // endpoint workflow (verify-data, operation-investigation, coo-review,
  // finance-review, finance-manager-review, compliance-review, resolve, close)
  // supaya setiap transisi selalu punya keputusan + catatan + aktor + waktu.
  // ValidationPipe whitelist membuang field ini kalau tetap dikirim, jadi
  // SystemAdmin/Director pun tidak bisa memotong alur lewat PATCH generik.

  @IsOptional() @IsString() @MaxLength(5000)
  resolution_notes?: string;
}

export class ListComplaintsQueryDto {
  @IsOptional() @IsString()
  q?: string;

  @IsOptional() @IsIn(COMPLAINT_STATUSES as any)
  status?: string;

  @IsOptional() @IsIn(COMPLAINT_LEVELS as any)
  complaint_level?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  customer_application_id?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit?: number;
}

// ── Workflow action payloads ────────────────────────────────────────────────
export class VerifyComplaintDataDto {
  @IsIn(['COMPLETE', 'INCOMPLETE'])
  data_verification_status!: string;

  // Wajib saat INCOMPLETE (data apa yang kurang harus tercatat).
  @ValidateIf((o) => o.data_verification_status === 'INCOMPLETE')
  @IsString() @IsNotEmpty() @MaxLength(5000)
  notes?: string;
}

export class OperationInvestigationDto {
  @IsIn(['SUCCESS', 'PENDING', 'FAILED', 'RETURNED', 'NEED_AML_REVIEW', 'NEED_FINANCE_REVIEW'])
  result!: string;

  @IsString() @IsNotEmpty() @MaxLength(5000)
  notes!: string;
}

// Kosakata per tahap (ditegakkan di service):
//   COMPLIANCE_REVIEW      → APPROVE | REJECT | HOLD | RETURN
//   COMPLIANCE_HOLD        → RESUME
//   AML_REVIEW / AML_HOLD  → APPROVE | REJECT | HOLD   (legacy)
export class AmlReviewDto {
  @IsIn(['APPROVE', 'REJECT', 'HOLD', 'RETURN', 'RESUME'])
  decision!: string;

  @IsString() @IsNotEmpty() @MaxLength(5000)
  notes!: string;
}

// NO_REFUND/REFUND_REQUIRED = tahap legacy FINANCE_REVIEW/REFUND_PROCESS.
// APPROVE/RETURN = tahap FINANCE_STAFF_REVIEW pada alur level. Ditegakkan di service.
export class ComplaintFinanceReviewDto {
  @IsIn(['NO_REFUND', 'REFUND_REQUIRED', 'APPROVE', 'RETURN'])
  decision!: string;

  @IsString() @IsNotEmpty() @MaxLength(5000)
  notes!: string;
}

export class CooReviewDto {
  @IsIn(['APPROVE', 'RETURN_TO_SUPERVISOR'])
  decision!: string;

  // Wajib untuk kedua keputusan — jejak alasan direksi harus selalu ada.
  @IsString() @IsNotEmpty() @MaxLength(5000)
  notes!: string;
}

export class FinanceManagerReviewDto {
  @IsIn(['APPROVE', 'RETURN'])
  decision!: string;

  @IsString() @IsNotEmpty() @MaxLength(5000)
  notes!: string;
}

export class ResolveComplaintDto {
  @IsString() @IsNotEmpty() @MaxLength(5000)
  resolution_notes!: string;

  @IsOptional() @IsString() @MaxLength(5000)
  customer_communication_notes?: string;
}

export class CloseComplaintDto {
  @IsString() @IsNotEmpty() @MaxLength(5000)
  closing_notes!: string;
}
