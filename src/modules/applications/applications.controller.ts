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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApplicationsService } from './applications.service';
import { CreateIndividualDto, CreateBusinessDto, AddDocumentDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UploadsService } from '../uploads/uploads.service';

@Controller('applications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApplicationsController {
  constructor(
    private readonly svc: ApplicationsService,
    private readonly uploads: UploadsService,
  ) {}

  @Get()
  async list(@Query('limit') limit = 20, @Query('offset') offset = 0) {
    return this.svc.list(Number(limit), Number(offset));
  }

  @Roles('BranchAdmin', 'ComplianceReviewer', 'ComplianceLead')
  @Post('individual')
  async createInd(
    @Req() req: any,
    @Body(new ValidationPipe({ whitelist: true })) dto: CreateIndividualDto,
  ) {
    return this.svc.createIndividual(dto, req.user.sub, 1);
  }

  @Roles('BranchAdmin', 'ComplianceReviewer', 'ComplianceLead')
  @Post('business')
  async createBiz(
    @Req() req: any,
    @Body(new ValidationPipe({ whitelist: true })) dto: CreateBusinessDto,
  ) {
    return this.svc.createBusiness(dto, req.user.sub, 1);
  }

  @Roles('BranchAdmin', 'ComplianceReviewer', 'ComplianceLead')
  @Post(':id/documents')
  async addDoc(
    @Param('id', ParseIntPipe) appId: number,
    @Body(new ValidationPipe({ whitelist: true })) dto: AddDocumentDto,
  ) {
    return this.svc.addDocument(appId, {
      doc_type: dto.doc_type,
      file_uri: dto.file_uri,
    });
  }


  @Get(':id/documents')
  async listDocs(@Param('id', ParseIntPipe) appId: number) {
    return this.svc.listDocuments(appId);
  }


  @Get(':id/documents/:docId')
  async getDoc(
    @Param('id', ParseIntPipe) appId: number,
    @Param('docId', ParseIntPipe) docId: number,
  ) {
    return this.svc.getDocument(appId, docId);
  }


  @Roles('BranchAdmin', 'ComplianceReviewer', 'ComplianceLead')
  @Post(':id/documents/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
      },
      fileFilter: (req, file, cb) => {
        const allowed = ['image/png', 'image/jpeg', 'application/pdf'];
        if (!allowed.includes(file.mimetype)) {
          return cb(new BadRequestException('File type not allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadDocument(
    @Param('id', ParseIntPipe) appId: number,
    @UploadedFile() file: Express.Multer.File,
    @Body('doc_type') docType?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    const ext = mimeToExt(file.mimetype);
    const { url, key } = await this.uploads.uploadBuffer(
      file.buffer,
      file.mimetype,
      ext,
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


  @Roles('ComplianceReviewer', 'ComplianceLead')
  @Patch(':id/submit')
  async submit(@Param('id', ParseIntPipe) appId: number, @Req() req: any) {
    return this.svc.submit(appId, req.user.sub);
  }


  @Roles('ComplianceReviewer', 'ComplianceLead')
  @Delete(':id/documents/:docId')
  async deleteDoc(
    @Param('id', ParseIntPipe) appId: number,
    @Param('docId', ParseIntPipe) docId: number,
  ) {
    const doc = await this.svc.deleteDocument(appId, docId);
    const key = doc?.extracted_json?.object_key as string | undefined;
    if (key) await this.uploads.deleteObject?.(key);
    return { ok: true, deleted_id: docId };
  }
}


function mimeToExt(mime: string) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'application/pdf') return 'pdf';
  return '';
}
function inferDocType(name?: string) {
  const n = (name || '').toUpperCase();
  if (n.includes('KTP')) return 'KTP';
  if (n.includes('PASPOR')) return 'PASPOR';
  if (n.includes('SIM')) return 'SIM';
  if (n.includes('AKTA')) return 'AKTA_PENDIRIAN';
  if (n.includes('NIB') || n.includes('SIUP')) return 'NIB_SIUP';
  if (n.includes('NPWP')) return 'NPWP_BADAN';
  return 'OTHER';
}
