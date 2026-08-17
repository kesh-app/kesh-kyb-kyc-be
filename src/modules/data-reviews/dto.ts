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

  // Versi draft yang dilihat Compliance saat memutuskan. Kalau draft sudah
  // bergerak, approval ditolak 409 — Compliance tidak boleh menyetujui
  // perubahan yang tidak pernah ia lihat.
  @IsOptional() @Type(() => Number) @IsInt()
  expected_version?: number;
}

// ── Draft / change-set (Pengkinian Data, ADR-047) ────────────────────────────

// Payload scalar draft sengaja TIDAK memakai DTO: bentuknya adalah patch field
// CDD bebas, dan service memvalidasinya terhadap allow-list kolom
// (PERSON_EDITABLE_COLUMNS / BUSINESS_EDITABLE_COLUMNS) — lebih ketat daripada
// endpoint CDD lama yang menerima `any` tanpa filter kolom sama sekali.

export const DRAFT_PARTY_OPERATIONS = ["ADD", "UPDATE", "DELETE"] as const;

export class StagePartyDraftDto {
  @IsIn(DRAFT_PARTY_OPERATIONS as unknown as string[], {
    message: "operation harus ADD, UPDATE, atau DELETE",
  })
  operation!: (typeof DRAFT_PARTY_OPERATIONS)[number];

  @IsOptional() @Type(() => Number) @IsInt()
  target_id?: number;

  @IsOptional()
  data?: Record<string, any>;

  @IsOptional() @Type(() => Number) @IsInt()
  expected_version?: number;
}

export const DRAFT_DOCUMENT_OPERATIONS = ["ADD", "REPLACE", "DELETE"] as const;

export class StageDocumentDraftDto {
  @IsIn(DRAFT_DOCUMENT_OPERATIONS as unknown as string[], {
    message: "operation harus ADD, REPLACE, atau DELETE",
  })
  operation!: (typeof DRAFT_DOCUMENT_OPERATIONS)[number];

  @IsOptional() @IsString()
  doc_type?: string;

  // Dipakai ADD/REPLACE saat berkas sudah ter-upload lebih dulu (mengikuti pola
  // AddDocumentDto yang sudah ada). Upload multipart memakai endpoint terpisah.
  @IsOptional() @IsString()
  file_uri?: string;

  @IsOptional() @Type(() => Number) @IsInt()
  target_id?: number;

  @IsOptional() @Type(() => Number) @IsInt()
  expected_version?: number;
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
