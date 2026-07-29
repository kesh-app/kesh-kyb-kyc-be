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

  @IsOptional() @IsIn(COMPLAINT_STATUSES as any)
  status?: string;

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

export class AmlReviewDto {
  @IsIn(['APPROVE', 'REJECT', 'HOLD'])
  decision!: string;

  @IsString() @IsNotEmpty() @MaxLength(5000)
  notes!: string;
}

export class ComplaintFinanceReviewDto {
  @IsIn(['NO_REFUND', 'REFUND_REQUIRED'])
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
