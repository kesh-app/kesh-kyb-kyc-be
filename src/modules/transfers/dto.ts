import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
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
  MinLength,
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

  // requestedTransferAt sengaja TIDAK ada di sini: "Tanggal Diminta" dibuat
  // backend saat transfer DISETUJUI Finance Manager (CURRENT_DATE), bukan saat
  // create dan bukan diinput admin/frontline. Kalau FE lama masih mengirimnya,
  // ValidationPipe `whitelist: true` membuangnya diam-diam — request tetap
  // 200/201, nilainya diabaikan.

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

  // transaction_date sengaja TIDAK ada di sini: tanggal transaksi dibuat backend
  // saat transfer DISETUJUI Finance Manager (COALESCE(transaction_date, now())),
  // bukan saat submit dan bukan dipilih user. Kalau FE lama masih mengirimnya,
  // ValidationPipe `whitelist: true` membuangnya diam-diam — request tetap 200,
  // nilainya diabaikan.
  //
  // requested_execution_date di bawah BEDA: itu "Tanggal Eksekusi Diminta"
  // (SNAP), memang input user dan tetap dipertahankan.

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

  // No. HP penerima — kolom "Ben Mobile Number", wajib untuk BI-Fast di BRI
  // Qlola. Wajib pada bulk baru supaya batch siap diekspor; transfer lama yang
  // dibuat sebelum ini tetap boleh NULL di DB (lihat migrasi 0068).
  // Format dibiarkan apa adanya selain trim: workbook BRI hanya menuntut
  // alfanumerik ("081234567890"), dan KESH belum punya aturan normalisasi
  // nomor telepon — jangan mengarang aturan baru di sini.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'beneficiary_mobile_number wajib diisi' })
  @MaxLength(30)
  @Matches(/^[0-9+][0-9]*$/, {
    message: 'beneficiary_mobile_number hanya boleh berisi angka (boleh diawali +)',
  })
  beneficiary_mobile_number!: string;
}

export class CreateBulkTransferDto {
  @IsInt()
  sender_application_id!: number;

  // Rekening debit BRI & nama pemilik rekening untuk export Qlola. Sama untuk
  // seluruh batch, jadi diisi sekali di level batch — bukan per baris penerima.
  // Panjang mengikuti sheet "Deskripsi File" workbook BRI: Debit Account 10-30,
  // Sender Name maksimal 60.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'qlola_debit_account wajib diisi' })
  @MinLength(10, { message: 'qlola_debit_account minimal 10 karakter' })
  @MaxLength(30, { message: 'qlola_debit_account maksimal 30 karakter' })
  qlola_debit_account!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'qlola_sender_name wajib diisi' })
  @MaxLength(60, { message: 'qlola_sender_name maksimal 60 karakter' })
  qlola_sender_name!: string;

  // bulk_reference_no SENGAJA tidak ada di DTO ini: nomornya dibuat backend
  // (BLK-XXXXXXXX). Client lama yang masih mengirimnya tidak ditolak — global
  // ValidationPipe (whitelist: true) membuangnya diam-diam, sehingga nilai
  // kiriman client tidak pernah bisa menimpa nomor yang digenerate.

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
  // @IsIn wajib: tanpa ini action yang tidak dikenal jatuh ke cabang else
  // service dan diam-diam menjadi REJECT.
  @IsIn(['APPROVE', 'REJECT'], { message: 'action harus APPROVE atau REJECT' })
  action!: 'APPROVE' | 'REJECT';

  @IsOptional() @IsString()
  notes?: string;

  @IsOptional() @IsString()
  reject_reason?: string;
}

// FinanceStaff punya satu aksi tambahan: RETURN (kembalikan untuk diperbaiki).
// OperationSupervisor sengaja tidak diberi aksi ini — di luar cakupan.
export class FinanceReviewTransferDto {
  @IsIn(['APPROVE', 'REJECT', 'RETURN'], {
    message: 'action harus APPROVE, REJECT, atau RETURN',
  })
  action!: 'APPROVE' | 'REJECT' | 'RETURN';

  // Wajib diisi bila action = RETURN (dicek di service, agar pesannya spesifik).
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
  // Diisi otomatis oleh screening beneficiary saat submit (bukan input manual).
  'WATCHLIST_HIT',
  'DTTOT_HIT',
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

export class RescreenTransferDto {
  // Transfer COMPLETED/REJECTED hanya di-preview (read-only) secara default —
  // force=true wajib untuk benar-benar mengganti transfer_watchlist_hits milik
  // transfer yang sudah settled.
  @IsOptional() @IsBoolean()
  force?: boolean;
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
