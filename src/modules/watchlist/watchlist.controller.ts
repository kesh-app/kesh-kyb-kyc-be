import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Get,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Req,
  Query,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { WatchlistService } from "./watchlist.service";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { UploadWatchlistDto } from "./dto";
import { resolveUserId } from "../../common/auth.util";

@Controller("watchlist")
@UseGuards(JwtAuthGuard, RolesGuard)
export class WatchlistController {
  constructor(private readonly svc: WatchlistService) {}

  // Upload watchlist adalah fitur Compliance — hanya ComplianceLead.
  // FrontDesk tidak boleh upload. SystemAdmin secara teknis masih lolos
  // via bypass global di RolesGuard, namun upload tidak diwajibkan untuk role tsb.
  @Roles("ComplianceLead")
  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
      },
      fileFilter: (req, file, cb) => {
        const ok =
          [
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel",
            "text/csv",
          ].includes(file.mimetype) ||
          /\.xlsx?$/i.test(file.originalname) ||
          /\.csv$/i.test(file.originalname);
        if (!ok)
          return cb(
            new BadRequestException("Only .xlsx/.xls/.csv allowed"),
            false,
          );
        cb(null, true);
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadWatchlistDto,
    @Req() req: Request & { user?: any }, // <-- tipe ditambahkan
  ) {
    if (!file) throw new BadRequestException("No file uploaded");
    return this.svc.ingestBuffer(
      file.buffer,
      body.list_type,
      body.list_source,
      Number(resolveUserId(req.user)),
      file.originalname,
    );
  }

  // Riwayat watchlist: ComplianceLead (owner fitur) + SystemAdmin (read-only).
  // FrontDesk & Auditor tidak diberi akses (paling aman; status quo Auditor tetap tanpa akses).
  @Roles("ComplianceLead", "SystemAdmin")
  @Get("history")
  async history(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("list_type") list_type?: string,
    @Query("source_list") source_list?: string,
    @Query("status") status?: string,
  ) {
    return this.svc.listIngestHistory({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      list_type: list_type?.trim() || undefined,
      source_list: source_list?.trim() || undefined,
      status: status?.trim() || undefined,
    });
  }

  // Data watchlist entries yang tersimpan (untuk FE menampilkan isi list, bukan hanya riwayat).
  // RBAC sama dengan history: ComplianceLead + SystemAdmin. FrontDesk/Auditor/Finance diblokir.
  // Catatan: watchlist_entries TIDAK punya relasi ke ingest log, jadi cara paling aman
  // memfilter data (termasuk existing) adalah via list_type / source_list.
  @Roles("ComplianceLead", "SystemAdmin")
  @Get("entries")
  async entries(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("list_type") list_type?: string,
    @Query("source_list") source_list?: string,
    @Query("watchlist_type") watchlist_type?: string,
    @Query("subject_type") subject_type?: string,
    @Query("q") q?: string,
  ) {
    return this.svc.listEntries({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      list_type: list_type?.trim() || undefined,
      source_list: source_list?.trim() || undefined,
      watchlist_type: watchlist_type?.trim() || undefined,
      subject_type: subject_type?.trim() || undefined,
      q: q?.trim() || undefined,
    });
  }
}
