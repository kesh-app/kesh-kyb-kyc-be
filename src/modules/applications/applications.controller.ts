import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
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
  async list(@Query("limit") limit = 20, @Query("offset") offset = 0) {
    return this.svc.list(Number(limit), Number(offset));
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

  @Roles("BranchAdmin", "ComplianceReviewer", "ComplianceLead")
  @Post("individual")
  async createInd(
    @Req() req: any,
    @Body(new ValidationPipe({ whitelist: true })) dto: CreateIndividualDto
  ) {
    return this.svc.createIndividual(dto, req.user.sub, 1);
  }

  @Roles("BranchAdmin", "ComplianceReviewer", "ComplianceLead")
  @Post("business")
  async createBiz(
    @Req() req: any,
    @Body(new ValidationPipe({ whitelist: true })) dto: CreateBusinessDto
  ) {
    return this.svc.createBusiness(dto, req.user.sub, 1);
  }

  @Roles("BranchAdmin", "ComplianceReviewer", "ComplianceLead")
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

  @Roles("BranchAdmin", "ComplianceReviewer", "ComplianceLead")
  @Get(":id/parties")
  async listParties(@Param("id", ParseIntPipe) appId: number) {
    return this.svc.listParties(appId);
  }

  @Roles("BranchAdmin", "ComplianceReviewer", "ComplianceLead")
  @Post(":id/parties")
  async addParty(
    @Param("id", ParseIntPipe) appId: number,
    @Body(new ValidationPipe({ whitelist: true })) dto: CreatePartyDto
  ) {
    return this.svc.addParty(appId, dto);
  }

  @Roles("BranchAdmin", "ComplianceReviewer", "ComplianceLead")
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
      `SELECT application_id, risk_score, risk_level, factors, created_at FROM application_risk WHERE application_id=$1`,
      [appId]
    );
    return { results, risk: risk[0] || null };
  }

  @Get(":id/documents")
  async listDocs(@Param("id", ParseIntPipe) appId: number) {
    return this.svc.listDocuments(appId);
  }

  @Get(":id/documents/:docId")
  async getDoc(
    @Param("id", ParseIntPipe) appId: number,
    @Param("docId", ParseIntPipe) docId: number
  ) {
    return this.svc.getDocument(appId, docId);
  }

  @Roles("BranchAdmin", "ComplianceReviewer", "ComplianceLead")
  @Post(":id/documents/upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
      },
      fileFilter: (req, file, cb) => {
        const allowed = ["image/png", "image/jpeg", "application/pdf"];
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
    const { url, key } = await this.uploads.uploadBuffer(
      file.buffer,
      file.mimetype,
      ext
    );

    const saved = await this.svc.addDocument(appId, {
      doc_type: docType || inferDocType(file.originalname),
      file_uri: url,
      extracted_json: {
        object_key: key,
        mime: file.mimetype,
        size: file.size ?? null,
        original_name: file.originalname ?? null,
      },
    });

    return { ...saved, file_url: url };
  }

  @Roles("ComplianceReviewer", "ComplianceLead")
  @Patch(":id/submit")
  async submit(@Param("id", ParseIntPipe) appId: number, @Req() req: any) {
    return this.svc.submit(appId, req.user.sub);
  }

  @Roles("ComplianceReviewer", "ComplianceLead")
  @Delete(":id/documents/:docId")
  async deleteDoc(
    @Param("id", ParseIntPipe) appId: number,
    @Param("docId", ParseIntPipe) docId: number
  ) {
    const doc = await this.svc.deleteDocument(appId, docId);
    const key = doc?.extracted_json?.object_key as string | undefined;
    if (key) await this.uploads.deleteObject?.(key);
    return { ok: true, deleted_id: docId };
  }
}

function mimeToExt(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "application/pdf") return "pdf";
  return "";
}
function inferDocType(name?: string) {
  const n = (name || "").toUpperCase();
  if (n.includes("KTP")) return "KTP";
  if (n.includes("PASPOR")) return "PASPOR";
  if (n.includes("SIM")) return "SIM";
  if (n.includes("AKTA")) return "AKTA_PENDIRIAN";
  if (n.includes("NIB") || n.includes("SIUP")) return "NIB_SIUP";
  if (n.includes("NPWP")) return "NPWP_BADAN";
  return "OTHER";
}
