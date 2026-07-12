import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

// ── Staff review (approval pertama — ComplianceStaff) ────────────────────────
export const STAFF_REVIEW_ACTIONS = [
  "ESCALATE_TO_MANAGER",
  "REQUEST_CLARIFICATION",
  "RECOMMEND_CLOSE_FALSE_POSITIVE",
] as const;

export class StaffReviewDto {
  @IsIn(STAFF_REVIEW_ACTIONS as any)
  action!: (typeof STAFF_REVIEW_ACTIONS)[number];

  @IsOptional() @IsString()
  notes?: string;
}

// ── Manager review (approval kedua — ComplianceLead / Compliance Manager) ────
export const MANAGER_REVIEW_ACTIONS = [
  "APPROVE_REPORT",
  "CLOSE_FALSE_POSITIVE",
  "REJECT",
  "REQUEST_CLARIFICATION",
] as const;

export class ManagerReviewDto {
  @IsIn(MANAGER_REVIEW_ACTIONS as any)
  action!: (typeof MANAGER_REVIEW_ACTIONS)[number];

  @IsOptional() @IsString()
  notes?: string;
}

// ── Legacy: Compliance review (deprecated alias → staff review) ──────────────
export const COMPLIANCE_ACTIONS = [
  "CLOSE_FALSE_POSITIVE",
  "NEED_CLARIFICATION",
  "ESCALATE_TO_DIRECTOR",
  "READY_TO_REPORT",
  "RECOMMEND_REPORT",
] as const;

export class ComplianceReviewDto {
  @IsIn(COMPLIANCE_ACTIONS as any)
  action!: (typeof COMPLIANCE_ACTIONS)[number];

  @IsOptional() @IsString()
  notes?: string;
}

// ── Legacy: Director review (deprecated alias → manager review) ──────────────
export const DIRECTOR_DECISIONS = [
  "APPROVED",
  "REJECTED",
  "REQUEST_MORE_INFO",
] as const;

export class DirectorReviewDto {
  @IsIn(DIRECTOR_DECISIONS as any)
  decision!: (typeof DIRECTOR_DECISIONS)[number];

  @IsOptional() @IsString()
  notes?: string;
}

// ── Report update ────────────────────────────────────────────────────────────
export const REPORT_STATUSES = [
  "READY_TO_SUBMIT",
  "SUBMITTED",
  "REJECTED_BY_REGULATOR",
  "ARCHIVED",
] as const;

export class UpdateReportDto {
  @IsIn(REPORT_STATUSES as any)
  report_status!: (typeof REPORT_STATUSES)[number];

  @IsOptional() @IsString() @MaxLength(100)
  report_reference_no?: string;

  @IsOptional() @IsString()
  report_file_uri?: string;

  @IsOptional() @IsDateString()
  reported_at?: string;
}
