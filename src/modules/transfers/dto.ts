import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateTransferDto {
  @IsInt()
  @Min(10_000, { message: 'amount minimal Rp10.000' })
  @Max(500_000_000, { message: 'amount maksimal Rp500.000.000' })
  amount!: number;

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
