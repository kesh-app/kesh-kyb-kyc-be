import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTransferDto {
  @IsInt()
  @Min(10_000, { message: 'amount minimal Rp10.000' })
  @Max(500_000_000, { message: 'amount maksimal Rp500.000.000' })
  amount!: number;

  // "Hubungan dengan Pengirim" — wajib diisi (single & bulk transfer).
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'beneficiary_relationship_to_sender wajib diisi' })
  @MaxLength(150)
  beneficiary_relationship_to_sender!: string;

  @IsString()
  beneficiaryBankName!: string;

  @IsOptional() @IsString()
  beneficiaryBankCode?: string;

  @IsInt()
  sender_application_id!: number;

  // Trim whitespace sebelum validasi; hanya digit yang diizinkan.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^\d+$/, {
    message: 'beneficiaryAccountNumber harus berisi digit saja (tanpa spasi, huruf, atau tanda baca)',
  })
  @IsString()
  beneficiaryAccountNumber!: string;

  @IsString()
  beneficiaryAccountName!: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsDateString()
  requestedTransferAt?: string; // YYYY-MM-DD

  // ── Transfer Recording v2 — SNAP-ready optional fields ──────────────
  // Semua opsional; backward compatible. Pakai snake_case agar mapping 1:1
  // ke kolom DB & sejalan dengan precedent sender_application_id.

  @IsOptional() @IsString() @MaxLength(64)
  partner_reference_no?: string;

  @IsOptional() @IsString() @MaxLength(34)
  source_account_no?: string;

  @IsOptional() @IsString() @MaxLength(100)
  source_account_name?: string;

  @IsOptional() @IsString() @MaxLength(8)
  source_bank_code?: string;

  @IsOptional() @IsString() @MaxLength(100)
  source_bank_name?: string;

  @IsOptional() @IsString() @MaxLength(255)
  beneficiary_address?: string;

  @IsOptional() @IsEmail() @MaxLength(100)
  beneficiary_email?: string;

  @IsOptional() @IsString() @Length(2, 2)
  beneficiary_customer_residence?: string;

  @IsOptional() @IsString() @Length(2, 2)
  beneficiary_customer_type?: string;

  @IsOptional() @IsString() @MaxLength(3)
  currency?: string;

  @IsOptional() @IsString() @MaxLength(32)
  transfer_method?: string;

  @IsOptional() @IsString() @MaxLength(32)
  transfer_channel?: string;

  @IsOptional() @IsDateString()
  transaction_date?: string;

  @IsOptional() @IsDateString()
  requested_execution_date?: string;

  @IsOptional() @IsObject()
  additional_info?: Record<string, unknown>;

  // ── Req F — sumber dana dan tujuan transaksi ────────────────────────
  @IsOptional() @IsString() @MaxLength(255)
  source_of_funds?: string;

  @IsOptional() @IsString() @MaxLength(255)
  transaction_purpose?: string;
}

export class UpdateTransferDto extends CreateTransferDto {}

// ── Bulk Transfer ────────────────────────────────────────────────────
// Satu item = satu transfer normal. sender_application_id ada di level batch.
// Item divalidasi sama seperti transfer normal (kecuali sender di level batch).
export class BulkTransferItemDto {
  @IsInt()
  @Min(10_000, { message: 'amount minimal Rp10.000' })
  @Max(500_000_000, { message: 'amount maksimal Rp500.000.000' })
  amount!: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'beneficiary_relationship_to_sender wajib diisi' })
  @MaxLength(150)
  beneficiary_relationship_to_sender!: string;

  @IsString()
  beneficiaryBankName!: string;

  @IsOptional() @IsString()
  beneficiaryBankCode?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^\d+$/, {
    message: 'beneficiaryAccountNumber harus berisi digit saja (tanpa spasi, huruf, atau tanda baca)',
  })
  @IsString()
  beneficiaryAccountNumber!: string;

  @IsString()
  beneficiaryAccountName!: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsString() @MaxLength(3)
  currency?: string;

  @IsOptional() @IsString() @MaxLength(255)
  source_of_funds?: string;

  @IsOptional() @IsString() @MaxLength(255)
  transaction_purpose?: string;
}

export class CreateBulkTransferDto {
  @IsInt()
  sender_application_id!: number;

  @IsArray()
  @ArrayNotEmpty({ message: 'items wajib diisi minimal 1' })
  @ArrayMinSize(1, { message: 'minimal 1 item' })
  @ArrayMaxSize(20, { message: 'maksimal 20 item per bulk transfer' })
  @ValidateNested({ each: true })
  @Type(() => BulkTransferItemDto)
  items!: BulkTransferItemDto[];
}

export class DecideTransferDto {
  @IsString()
  decision!: 'APPROVE' | 'REJECT';

  // Legacy field — dipertahankan untuk backward compatibility.
  @IsOptional() @IsString()
  note?: string;

  @IsOptional() @IsString()
  decision_notes?: string;

  @IsOptional() @IsString()
  reject_reason?: string;
}

export class ReviewTransferDto {
  @IsString()
  action!: 'APPROVE' | 'REJECT';

  @IsOptional() @IsString()
  notes?: string;

  @IsOptional() @IsString()
  reject_reason?: string;
}

// ── Compliance Review (flagged transfer) ─────────────────────────────
// Kode red flag internal — TIDAK boleh terekspos ke field customer-facing.
export const TRANSFER_RED_FLAG_CODES = [
  'AMOUNT_NOT_MATCH_PROFILE',
  'PURPOSE_NOT_MATCH_PROFILE',
  'UNUSUAL_FREQUENCY',
  'UNUSUAL_VOLUME',
  'NEW_BENEFICIARY_HIGH_AMOUNT',
  'STRUCTURING_PATTERN',
  'RBA_HIGH',
  'RBA_INCOMPLETE',
  'WATCHLIST_NEAR_MATCH',
  'DOCUMENT_OR_INFORMATION_UNUSUAL',
  'OTHER',
] as const;

export const COMPLIANCE_REVIEW_ACTIONS = [
  'APPROVE_TO_CONTINUE',
  'REJECT',
  'REQUEST_ADDITIONAL_INFO',
  'REQUEST_EDD',
  'MARK_LTKM_CANDIDATE',
] as const;

export class SubmitComplianceReviewDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'red_flags wajib diisi dan tidak boleh kosong' })
  @IsIn(TRANSFER_RED_FLAG_CODES as unknown as string[], {
    each: true,
    message: 'red_flags mengandung kode yang tidak valid',
  })
  red_flags!: string[];

  @IsOptional() @IsString() @MaxLength(1000)
  report_notes?: string;
}

export class ComplianceReviewDecisionDto {
  @IsIn(COMPLIANCE_REVIEW_ACTIONS as unknown as string[], {
    message: 'action tidak valid',
  })
  action!: (typeof COMPLIANCE_REVIEW_ACTIONS)[number];

  @IsOptional() @IsString() @MaxLength(1000)
  decision_notes?: string;
}

export class SetTransferResultDto {
  @IsString()
  result!: 'SUCCESS' | 'FAILED';

  // Legacy fields — dipertahankan untuk backward compatibility.
  @IsOptional() @IsString()
  note?: string;

  @IsOptional() @IsString()
  attachmentUri?: string;

  // ── Transfer Recording v2 — provider/result mapping (opsional) ──────
  @IsOptional() @IsString()
  result_notes?: string;

  @IsOptional() @IsString() @MaxLength(64)
  result_reference_no?: string;

  @IsOptional() @IsString()
  result_attachment_uri?: string;

  @IsOptional() @IsString() @MaxLength(64)
  bank_reference_no?: string;

  @IsOptional() @IsString() @MaxLength(64)
  external_reference_no?: string;

  @IsOptional() @IsString() @MaxLength(64)
  provider_reference_no?: string;

  @IsOptional() @IsString() @MaxLength(16)
  latest_transaction_status?: string;

  @IsOptional() @IsString() @MaxLength(150)
  transaction_status_desc?: string;

  @IsOptional() @IsString() @MaxLength(16)
  provider_response_code?: string;

  @IsOptional() @IsString() @MaxLength(255)
  provider_response_message?: string;

  @IsOptional() @IsObject()
  provider_response?: Record<string, unknown>;

  @IsOptional() @IsString()
  failed_reason?: string;
}
