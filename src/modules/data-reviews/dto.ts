import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

export class InitiateDataReviewDto {
  @IsOptional() @IsIn(["MANUAL", "PERIODIC"])
  review_type?: "MANUAL" | "PERIODIC";

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export const DATA_REVIEW_DECISIONS = [
  "APPROVED",
  "RETURN_FOR_REVISION",
  "REJECTED",
] as const;

export class DataReviewDecisionDto {
  @IsIn(DATA_REVIEW_DECISIONS as unknown as string[], {
    message: "decision tidak valid",
  })
  decision!: (typeof DATA_REVIEW_DECISIONS)[number];

  @IsOptional() @IsString() @MaxLength(1000)
  reason?: string;
}

export const DUE_STATUSES = [
  "NOT_DUE",
  "DUE_SOON",
  "DUE",
  "OVERDUE",
  "NEED_RISK_SCORE",
  "NO_SUBMITTED_DATE",
] as const;

export const REVIEW_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "IN_COMPLIANCE_REVIEW",
  "APPROVED",
  "RETURNED_FOR_REVISION",
  "REJECTED",
  "CANCELLED",
] as const;

/** Worklist Pengkinian Data — filter untuk GET /data-reviews */
export class ListDataReviewsQueryDto {
  @IsOptional() @IsString()
  q?: string;

  @IsOptional() @IsIn(["LOW", "MEDIUM", "HIGH"])
  risk_level?: string;

  @IsOptional() @IsIn(DUE_STATUSES as unknown as string[])
  due_status?: string;

  @IsOptional() @IsIn(REVIEW_STATUSES as unknown as string[])
  review_status?: string;

  @IsOptional() @IsIn(["INDIVIDUAL", "BUSINESS"])
  customer_type?: "INDIVIDUAL" | "BUSINESS";

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit?: number;
}
