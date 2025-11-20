import { BadRequestException, Body, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { WatchlistService } from './watchlist.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UploadWatchlistDto } from './dto';

@Controller('watchlist')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WatchlistController {
  constructor(private readonly svc: WatchlistService) {}

  // Upload Excel/CSV PEP / DTTOT / PPPSPM
  @Roles('ComplianceReviewer','ComplianceLead')
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ok = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv'].includes(file.mimetype)
              || /\.xlsx?$/i.test(file.originalname) || /\.csv$/i.test(file.originalname);
      if (!ok) return cb(new BadRequestException('Only .xlsx/.xls/.csv allowed'), false);
      cb(null, true);
    }
  }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadWatchlistDto
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.svc.ingestBuffer(file.buffer, body.list_type, body.list_source);
  }

  // Screening: input nama (+ optional DOB/Nationality) → kandidat watchlist
  @Roles('BranchAdmin','ComplianceReviewer','ComplianceLead','Auditor')
  @Post('screen/person')
  async screen(@Body() body: { name: string; dob?: string; nationality?: string; limit?: number }) {
    if (!body?.name) throw new BadRequestException('name is required');
    return this.svc.screenPerson({ name: body.name, dob: body.dob || null, nationality: body.nationality || null, limit: body.limit });
  }
}
