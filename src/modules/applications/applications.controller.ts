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
import { ApplicationsService } from "./applications.service";
import {
  CreateIndividualDto,
  CreateBusinessDto,
  AddDocumentDto,
  CreatePartyDto,
  DecisionDto,
  ListApplicationsQueryDto,
} from "./dto";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { UploadsService } from "../uploads/uploads.service";

@Controller("applications")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApplicationsController {
  constructor(
    private readonly svc: ApplicationsService,
    private readonly uploads: UploadsService
  ) {}

  @Get()
  async list(
    @Query(new ValidationPipe({ whitelist: true, transform: true }))
    query: ListApplicationsQueryDto,
  ) {
    return this.svc.list(query);
  }

  @Get(":id")
  async detail(@Param("id", ParseIntPipe) appId: number) {
    return this.svc.getDetail(appId);
  }

  /** (Opsional) quick pre-check tanpa submit */
  @Get(":id/precheck")
  async precheck(@Param("id", ParseIntPipe) appId: number) {
    return this.svc.validateBeforeSubmit(appId);
  }

  @Roles("BranchAdmin", "FrontDesk", "ComplianceLead")
  @Post("individual")
  async createInd(
    @Req() req: any,
    @Body(new ValidationPipe({ whitelist: true })) dto: CreateIndividualDto
  ) {
    return this.svc.createIndividual(dto, req.user.sub, 1);
  }

  @Roles("BranchAdmin", "FrontDesk", "ComplianceLead")
  @Post("business")
  async createBiz(
    @Req() req: any,
    @Body(new ValidationPipe({ whitelist: true })) dto: CreateBusinessDto
  ) {
    return this.svc.createBusiness(dto, req.user.sub, 1);
  }

  @Roles("BranchAdmin", "FrontDesk", "ComplianceLead")
  @Post(":id/documents")
  async addDoc(
    @Param("id", ParseIntPipe) appId: number,
    @Body(new ValidationPipe({ whitelist: true })) dto: AddDocumentDto
  ) {
    return this.svc.addDocument(appId, {
      doc_type: dto.doc_type,
      file_uri: dto.file_uri,
    });
  }

  @Roles("BranchAdmin", "FrontDesk", "ComplianceLead", "SystemAdmin")
  @Get(":id/parties")
  async listParties(@Param("id", ParseIntPipe) appId: number) {
    return this.svc.listParties(appId);
  }

  @Roles("BranchAdmin", "FrontDesk", "ComplianceLead")
  @Post(":id/parties")
  async addParty(
    @Param("id", ParseIntPipe) appId: number,
    @Body(new ValidationPipe({ whitelist: true })) dto: CreatePartyDto
  ) {
    return this.svc.addParty(appId, dto);
  }

  @Roles("BranchAdmin", "FrontDesk", "ComplianceLead")
  @Delete(":id/parties/:partyId")
  async removeParty(
    @Param("id", ParseIntPipe) appId: number,
    @Param("partyId", ParseIntPipe) partyId: number
  ) {
    return this.svc.deleteParty(appId, partyId);
  }

  // detail aplikasi sdh ada; tambahkan endpoint hasil screening & risk
  @Get(":id/screening")
  async screening(@Param("id", ParseIntPipe) appId: number) {
    const { rows: results } = await this.svc["pool"].query(
      `SELECT subject_type, subject_ref, list_type, watchlist_id, matched_name, matched_dob, matched_nationality, score, created_at
     FROM screening_results WHERE application_id=$1 ORDER BY score DESC, created_at DESC`,
      [appId]
    );
    const { rows: risk } = await this.svc["pool"].query(
      `SELECT application_id, risk_score::float AS risk_score, risk_level, factors, risk_factors, created_at FROM application_risk WHERE application_id=$1`,
      [appId]
    );
    return { results, risk: risk[0] || null };
  }

  @Get(":id/documents")
  async listDocs(@Param("id", ParseIntPipe) appId: number) {
    return this.svc.listDocuments(appId);
  }

  @Get(":id/documents/:docId/url")
  async getDocumentUrl(
    @Param("id", ParseIntPipe) appId: number,
    @Param("docId", ParseIntPipe) docId: number,
  ) {
    const doc = await this.svc.getDocument(appId, docId);
    const key =
      (doc.extracted_json?.object_key as string | undefined) ?? doc.file_uri;
    const signedUrl = await this.uploads.getSignedUrl(key);
    return { signed_url: signedUrl, expires_in: 300 };
  }

  @Get(":id/documents/:docId")
  async getDoc(
    @Param("id", ParseIntPipe) appId: number,
    @Param("docId", ParseIntPipe) docId: number
  ) {
    return this.svc.getDocument(appId, docId);
  }

  @Roles("BranchAdmin", "FrontDesk", "ComplianceLead")
  @Post(":id/documents/upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
      },
      fileFilter: (req, file, cb) => {
        const allowed = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
        if (!allowed.includes(file.mimetype)) {
          return cb(new BadRequestException("File type not allowed"), false);
        }
        cb(null, true);
      },
    })
  )
  async uploadDocument(
    @Param("id", ParseIntPipe) appId: number,
    @UploadedFile() file: Express.Multer.File,
    @Body("doc_type") docType?: string
  ) {
    if (!file) throw new BadRequestException("No file uploaded");

    const ext = mimeToExt(file.mimetype);
    const inferredDocType = docType || inferDocType(file.originalname);

    let objectKey: string | undefined;
    if (this.uploads.isObs()) {
      const appType = await this.svc.getApplicationType(appId);
      const prefix = appType === "BUSINESS" ? "kyb" : "kyc";
      const safeFilename = sanitizeFilename(file.originalname);
      objectKey = `${prefix}/${appId}/${inferredDocType}/${Date.now()}-${safeFilename}.${ext}`;
    }

    let uploadResult: { key: string; url: string };
    try {
      uploadResult = await this.uploads.uploadBuffer(
        file.buffer,
        file.mimetype,
        ext,
        objectKey,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new InternalServerErrorException(`File storage failed: ${msg}`);
    }

    const saved = await this.svc.addDocument(appId, {
      doc_type: inferredDocType,
      // OBS: store the object key; LOCAL: store the full public URL
      file_uri: uploadResult.url,
      extracted_json: {
        object_key: uploadResult.key,
        mime: file.mimetype,
        size: file.size ?? null,
        original_name: file.originalname ?? null,
      },
    });

    // For OBS: return a fresh signed URL valid for 5 min.
    // For LOCAL: return the direct static URL.
    const fileUrl = this.uploads.isObs()
      ? await this.uploads.getSignedUrl(uploadResult.key)
      : uploadResult.url;

    return { ...saved, file_url: fileUrl };
  }


  @Roles("FrontDesk", "ComplianceLead")
  @Patch(":id")
  async updateCdd(
    @Param("id", ParseIntPipe) appId: number,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.svc.updateIndividualCdd(appId, body, req.user.sub);
  }

  // ── EDD endpoints ────────────────────────────────────────────────────────

  @Roles("FrontDesk", "ComplianceLead", "Auditor")
  @Get(":id/edd")
  async getEdd(@Param("id", ParseIntPipe) appId: number) {
    return this.svc.getEdd(appId);
  }

  @Roles("FrontDesk")
  @Patch(":id/edd")
  async saveEdd(
    @Param("id", ParseIntPipe) appId: number,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.svc.saveEdd(appId, body, req.user.sub);
  }

  // ─────────────────────────────────────────────────────────────────────────

  @Roles("FrontDesk", "ComplianceLead")
  @Patch(":id/submit")
  async submit(@Param("id", ParseIntPipe) appId: number, @Req() req: any) {
    return this.svc.submit(appId, req.user.sub);
  }

  // KYC/KYB decision: OperationSupervisor untuk LOW/MEDIUM risk,
  // ComplianceLead untuk HIGH risk, Director/SystemAdmin via bypass.
  @Roles("OperationSupervisor", "ComplianceLead")
  @Patch(":id/decision")
  async decide(
    @Param("id", ParseIntPipe) appId: number,
    @Body(new ValidationPipe({ whitelist: true })) dto: DecisionDto,
    @Req() req: any,
  ) {
    return this.svc.decide(appId, dto.decision, dto.reason ?? null, req.user);
  }

  @Roles("FrontDesk", "ComplianceLead")
  @Delete(":id/documents/:docId")
  async deleteDoc(
    @Param("id", ParseIntPipe) appId: number,
    @Param("docId", ParseIntPipe) docId: number
  ) {
    const doc = await this.svc.deleteDocument(appId, docId);
    const key = doc?.extracted_json?.object_key as string | undefined;
    if (key) await this.uploads.deleteObject(key);
    return { ok: true, deleted_id: docId };
  }
}

function mimeToExt(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "application/pdf") return "pdf";
  return "";
}
function inferDocType(name?: string) {
  const n = (name || "").toUpperCase();
  if (n.includes("FACE_WITH_KTP") || n.includes("WAJAH_KTP")) return "INDIVIDUAL_FACE_WITH_KTP_PHOTO";
  if (n.includes("INDIVIDUAL_KTP") || n.includes("KTP_PHOTO")) return "INDIVIDUAL_KTP_PHOTO";
  if (n.includes("FACE_PHOTO") || n.includes("FACE") || n.includes("WAJAH")) return "INDIVIDUAL_FACE_PHOTO";
  if (n.includes("KTP")) return "KTP";
  if (n.includes("PASPOR")) return "PASPOR";
  if (n.includes("SIM")) return "SIM";
  if (n.includes("SIGNATURE") || n.includes("TTD") || n.includes("TANDA_TANGAN")) return "SIGNATURE";
  if (n.includes("AKTA")) return "AKTA_PENDIRIAN";
  if (n.includes("NIB") || n.includes("SIUP")) return "NIB_SIUP";
  if (n.includes("NPWP")) return "NPWP_BADAN";
  return "OTHER";
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .substring(0, 100);
}
