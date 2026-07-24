import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

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
