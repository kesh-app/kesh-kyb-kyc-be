import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { DataReviewsService } from "./data-reviews.service";
import { DataReviewDraftsService } from "./data-review-drafts.service";
import { UploadsService } from "../uploads/uploads.service";
import {
  InitiateDataReviewDto,
  DataReviewDecisionDto,
  ListDataReviewsQueryDto,
  StagePartyDraftDto,
  StageDocumentDraftDto,
} from "./dto";
import {
  DATA_REVIEW_DECISION_ROUTE_ROLES,
  DATA_REVIEW_DRAFT_ROUTE_ROLES,
  DATA_REVIEW_INITIATE_ROUTE_ROLES,
  DATA_REVIEW_READ_ROUTE_ROLES,
} from "../../common/kyc-access";

// Worklist Pengkinian Data untuk menu FE.
// Read-only: FrontDesk + ComplianceLead + Auditor (SystemAdmin/Director via bypass).
// Aksi tetap lewat endpoint /applications/:id/data-review/* yang sudah ada.
@Controller("data-reviews")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DataReviewsListController {
  constructor(private readonly svc: DataReviewsService) {}

  @Get()
  @Roles(...DATA_REVIEW_READ_ROUTE_ROLES)
  async list(
    @Query(new ValidationPipe({ whitelist: true, transform: true }))
    query: ListDataReviewsQueryDto,
  ) {
    return this.svc.list(query);
  }
}

// Pengkinian Data / Periodic Customer Data Review.
// Alur: ComplianceLead menganalisis & meminta pengkinian (initiate) → FrontDesk
// memperbarui data lewat form CDD/KYC/KYB yang ada lalu submit → ComplianceLead
// approve/return/reject.
// Record ini melacak workflow/audit; data pengguna jasa yang diperbarui tetap
// disimpan lewat endpoint KYC/KYB yang ada (tidak diduplikasi di sini).
@Controller("applications/:id/data-review")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DataReviewsController {
  constructor(private readonly svc: DataReviewsService) {}

  // STATUS — read-only (FrontDesk, ComplianceLead, Auditor; SystemAdmin/Director via bypass)
  @Get("status")
  @Roles(...DATA_REVIEW_READ_ROUTE_ROLES)
  async status(@Param("id", ParseIntPipe) id: number) {
    return this.svc.getStatus(id);
  }

  // INITIATE / REQUEST — ComplianceLead atau FrontDesk, kapan saja
  // (tidak harus menunggu jatuh tempo).
  @Post("initiate")
  @Roles(...DATA_REVIEW_INITIATE_ROUTE_ROLES)
  async initiate(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: InitiateDataReviewDto,
  ) {
    return this.svc.initiate(id, req.user, dto);
  }

  // SUBMIT hasil pengkinian untuk direview Compliance — FrontDesk saja
  // (ComplianceLead tidak boleh submit mewakili FrontDesk).
  @Post("submit")
  @Roles(...DATA_REVIEW_DRAFT_ROUTE_ROLES)
  async submit(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    return this.svc.submit(id, req.user);
  }

  // DECISION — ComplianceLead (approve / return / reject)
  @Post("decision")
  @Roles(...DATA_REVIEW_DECISION_ROUTE_ROLES)
  async decision(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: DataReviewDecisionDto,
  ) {
    return this.svc.decision(id, req.user, dto);
  }
}

// Draft Pengkinian Data (ADR-047). Perubahan di sini HANYA masuk change-set —
// tabel live (persons/business_entities/business_parties/documents/
// application_edd) tidak tersentuh sampai Compliance menyetujui.
//
// Sengaja terpisah dari endpoint CDD biasa: endpoint lama tetap otoritatif
// untuk onboarding & alur REVISION_REQUIRED, dan applications.status TETAP
// APPROVED sepanjang siklus pengkinian.
@Controller("data-reviews/:reviewId")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DataReviewDraftsController {
  constructor(
    private readonly drafts: DataReviewDraftsService,
    private readonly uploads: UploadsService,
  ) {}

  // Read model: review + current + proposed + changes. Satu panggilan untuk
  // form Frontline maupun layar diff Compliance.
  @Get("draft")
  @Roles(...DATA_REVIEW_READ_ROUTE_ROLES)
  async getDraft(@Param("reviewId", ParseIntPipe) reviewId: number) {
    return this.drafts.getDraft(reviewId);
  }

  @Get("changes")
  @Roles(...DATA_REVIEW_READ_ROUTE_ROLES)
  async listChanges(@Param("reviewId", ParseIntPipe) reviewId: number) {
    const rows = await this.drafts.activeChanges(reviewId);
    return { data: rows.map((r) => this.drafts.presentChange(r)) };
  }

  // ── Staging (FrontDesk saja; ComplianceLead mereview, tidak menyunting) ──
  @Patch("draft/person")
  @Roles(...DATA_REVIEW_DRAFT_ROUTE_ROLES)
  async stagePerson(
    @Req() req: any,
    @Param("reviewId", ParseIntPipe) reviewId: number,
    @Body() body: any,
  ) {
    const { expected_version, ...patch } = body ?? {};
    return this.drafts.stagePerson(reviewId, req.user, patch, expected_version);
  }

  @Patch("draft/business")
  @Roles(...DATA_REVIEW_DRAFT_ROUTE_ROLES)
  async stageBusiness(
    @Req() req: any,
    @Param("reviewId", ParseIntPipe) reviewId: number,
    @Body() body: any,
  ) {
    const { expected_version, ...patch } = body ?? {};
    return this.drafts.stageBusiness(reviewId, req.user, patch, expected_version);
  }

  @Post("draft/parties")
  @Roles(...DATA_REVIEW_DRAFT_ROUTE_ROLES)
  async stageParty(
    @Req() req: any,
    @Param("reviewId", ParseIntPipe) reviewId: number,
    @Body() dto: StagePartyDraftDto,
  ) {
    return this.drafts.stageParty(reviewId, req.user, dto);
  }

  @Post("draft/documents")
  @Roles(...DATA_REVIEW_DRAFT_ROUTE_ROLES)
  async stageDocument(
    @Req() req: any,
    @Param("reviewId", ParseIntPipe) reviewId: number,
    @Body() dto: StageDocumentDraftDto,
  ) {
    return this.drafts.stageDocument(reviewId, req.user, dto);
  }

  /** Upload bytes directly into the review staging prefix, then stage ADD/REPLACE. */
  @Post("draft/documents/upload")
  @Roles(...DATA_REVIEW_DRAFT_ROUTE_ROLES)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
      },
      fileFilter: (_req, file, cb) => {
        const allowed = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
        if (!allowed.includes(file.mimetype)) {
          return cb(new BadRequestException("File type not allowed"), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadDraftDocument(
    @Req() req: any,
    @Param("reviewId", ParseIntPipe) reviewId: number,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: StageDocumentDraftDto,
  ) {
    if (!file) throw new BadRequestException("No file uploaded");
    if (!dto || !["ADD", "REPLACE"].includes(dto.operation)) {
      throw new BadRequestException("Upload dokumen hanya mendukung ADD atau REPLACE.");
    }
    if (dto.operation === "ADD" && !dto.doc_type) {
      throw new BadRequestException("doc_type wajib diisi.");
    }
    if (dto.operation === "REPLACE" && !dto.target_id) {
      throw new BadRequestException("target_id wajib untuk REPLACE dokumen.");
    }

    await this.drafts.assertCanEdit(reviewId, req.user, dto.expected_version);

    const extByMime: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "application/pdf": "pdf",
    };
    const ext = extByMime[file.mimetype] ?? "bin";
    const objectKey = this.drafts.stagingObjectKey(
      reviewId,
      dto.doc_type ?? "DOC",
      `.${ext}`,
    );

    let uploaded: { key: string; url: string; meta?: any };
    try {
      uploaded = await this.uploads.uploadBuffer(
        file.buffer,
        file.mimetype,
        ext,
        objectKey,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new InternalServerErrorException(`File storage failed: ${message}`);
    }

    try {
      const staged = await this.drafts.stageDocument(reviewId, req.user, {
        ...dto,
        file_uri: this.uploads.isObs() ? uploaded.key : uploaded.url,
        staged_object_key: uploaded.key,
      });
      const accessibleUrl = await this.uploads
        .getSignedUrl(uploaded.key)
        .catch(() => uploaded.url);
      return {
        ...staged,
        upload: {
          key: uploaded.key,
          url: accessibleUrl,
          mime: file.mimetype,
          size: file.size ?? null,
          original_name: file.originalname ?? null,
        },
      };
    } catch (err) {
      await this.uploads.deleteObject(uploaded.key).catch(() => undefined);
      throw err;
    }
  }

  @Patch("draft/edd")
  @Roles(...DATA_REVIEW_DRAFT_ROUTE_ROLES)
  async stageEdd(
    @Req() req: any,
    @Param("reviewId", ParseIntPipe) reviewId: number,
    @Body() body: any,
  ) {
    const { expected_version, ...patch } = body ?? {};
    return this.drafts.stageEdd(reviewId, req.user, patch, expected_version);
  }

  @Delete("draft/changes/:changeId")
  @Roles(...DATA_REVIEW_DRAFT_ROUTE_ROLES)
  async discard(
    @Req() req: any,
    @Param("reviewId", ParseIntPipe) reviewId: number,
    @Param("changeId", ParseIntPipe) changeId: number,
  ) {
    return this.drafts.discardChange(reviewId, changeId, req.user);
  }
}
