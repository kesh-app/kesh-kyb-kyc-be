import { Type, Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
} from "class-validator";

export const REFUND_STATUSES = [
  "UNMATCHED",
  "MATCHED",
  "NEED_INVESTIGATION",
  "PENDING_APPROVAL",
  "APPROVED",
  "BALANCE_CREDITED",
  "REJECTED",
  "DUPLICATE",
] as const;

const trim = () =>
  Transform(({ value }) => (typeof value === "string" ? value.trim() : value));

export class CreateStatementRefundDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  complaint_id?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  original_transfer_id?: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "statement_date must be YYYY-MM-DD" })
  statement_date!: string;

  @IsISO8601({}, { message: "received_at must be an ISO8601 datetime" })
  received_at!: string;

  @Type(() => Number) @IsNumber() @IsPositive({ message: "amount must be greater than 0" })
  amount!: number;

  @IsOptional() @IsIn(["IDR"])
  currency?: string;

  @IsOptional() @trim() @IsString() @MaxLength(34)
  bank_account_no?: string;

  @IsOptional() @trim() @IsString() @MaxLength(100)
  bank_name?: string;

  @IsOptional() @trim() @IsString() @MaxLength(64)
  bank_reference_no?: string;

  @IsOptional() @trim() @IsString() @MaxLength(2000)
  statement_description?: string;

  @IsOptional() @trim() @IsString() @MaxLength(2000)
  investigation_notes?: string;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  evidence_uri?: string;
}

/** PATCH — hanya field pencatatan, bukan workflow. Status diubah lewat aksi. */
export class UpdateStatementRefundDto {
  @IsOptional() @trim() @IsString() @MaxLength(100)
  bank_name?: string;

  @IsOptional() @trim() @IsString() @MaxLength(34)
  bank_account_no?: string;

  @IsOptional() @trim() @IsString() @MaxLength(2000)
  statement_description?: string;

  @IsOptional() @trim() @IsString() @MaxLength(2000)
  investigation_notes?: string;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  evidence_uri?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  complaint_id?: number;
}

export class MatchStatementRefundDto {
  @Type(() => Number) @IsInt() @Min(1)
  original_transfer_id!: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  complaint_id?: number;

  @IsOptional() @IsIn(["MANUAL", "AUTO_SUGGESTED"])
  match_method?: "MANUAL" | "AUTO_SUGGESTED";

  @IsOptional() @trim() @IsString() @MaxLength(2000)
  investigation_notes?: string;
}

export class StatementRefundDecisionDto {
  @IsIn(["APPROVED", "REJECTED"], { message: "decision tidak valid" })
  decision!: "APPROVED" | "REJECTED";

  @IsOptional() @trim() @IsString() @MaxLength(2000)
  finance_notes?: string;

  @IsOptional() @trim() @IsString() @MaxLength(2000)
  reason?: string;
}

export class ListStatementRefundsQueryDto {
  @IsOptional() @IsString()
  q?: string;

  @IsOptional() @IsIn(REFUND_STATUSES as unknown as string[])
  status?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "statement_date_from must be YYYY-MM-DD" })
  statement_date_from?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "statement_date_to must be YYYY-MM-DD" })
  statement_date_to?: string;

  @IsOptional() @IsISO8601()
  received_from?: string;

  @IsOptional() @IsISO8601()
  received_to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  partner_application_id?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit?: number;
}
