import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

/**
 * INDIVIDUAL (KYC)
 */
export class CreateIndividualDto {
  @IsString()
  @IsNotEmpty()
  full_name!: string;

  @IsOptional()
  @IsString()
  alias?: string;

  // Nomor KTP (NIK) — wajib untuk Our Customer. Untuk WIC, wajib hanya jika identity_type = KTP.
  @ValidateIf(
    (o) => o.cif_relationship_type !== "WIC" || o.identity_type === "KTP",
  )
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{15,16}$/, { message: "ktp_number harus 15-16 digit angka" })
  ktp_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  sim_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  passport_number?: string;

  @IsIn(["KTP", "SIM", "PASPOR", "LAINNYA"])
  identity_type!: "KTP" | "SIM" | "PASPOR" | "LAINNYA";

  @IsString()
  @IsNotEmpty()
  identity_number!: string;

  // Legacy: wajib untuk WIC sebagai alamat minimal sesuai identitas.
  @ValidateIf((o) => o.cif_relationship_type === "WIC")
  @IsString()
  @IsNotEmpty()
  address_identity?: string;

  @IsOptional()
  @IsString()
  address_residential?: string;

  // Alamat terstruktur (opsional)
  @IsOptional()
  @IsString()
  province_code?: string;

  @IsOptional()
  @IsString()
  city_code?: string;

  @IsOptional()
  @IsString()
  district_code?: string;

  @IsOptional()
  @IsString()
  village_code?: string;

  @IsOptional()
  @IsString()
  street_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  house_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  rt_rw?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  apartment_block?: string;

  @IsOptional()
  @IsString()
  address_landmark?: string;

  @IsString()
  @IsNotEmpty()
  pob!: string;

  @IsDateString()
  dob!: string;

  @ValidateIf((o) => o.cif_relationship_type !== "WIC")
  @IsString()
  @IsNotEmpty()
  nationality?: string;

  @ValidateIf((o) => o.cif_relationship_type !== "WIC")
  @IsString()
  @IsNotEmpty()
  phone?: string;

  @ValidateIf((o) => o.cif_relationship_type !== "WIC")
  @IsString()
  @IsNotEmpty()
  occupation!: string;

  // Pekerjaan tambahan (opsional)
  @IsOptional()
  @IsString()
  industry_category?: string;

  // "Lainnya" free-text companions. Diisi hanya bila dropdown terkait bernilai
  // "Lainnya"; TIDAK menggantikan nilai dropdown (RBA V01 strict).
  @IsOptional()
  @IsString()
  occupation_other?: string;

  @IsOptional()
  @IsString()
  industry_category_other?: string;

  @IsOptional()
  @IsString()
  company_name?: string;

  @IsOptional()
  @IsString()
  company_address?: string;

  @IsOptional()
  @IsString()
  monthly_income_range?: string;

  @ValidateIf((o) => o.cif_relationship_type !== "WIC")
  @IsIn(["M", "F", "O"])
  gender?: "M" | "F" | "O";

  @IsOptional()
  @IsEmail()
  email?: string;

  // Wajib saat SUBMIT, boleh kosong saat DRAFT
  @IsOptional()
  @IsString()
  signature_uri?: string;

  // CIF relationship type — OUR_CUSTOMER (default) atau WIC; BO tidak diizinkan pada individual create
  @IsOptional()
  @IsIn(["OUR_CUSTOMER", "WIC"])
  cif_relationship_type?: "OUR_CUSTOMER" | "WIC";

  // ── WIC / Walk-In Customer fields ──────────────────────────────────────────
  @ValidateIf((o) => o.cif_relationship_type === "WIC")
  @IsString()
  @IsNotEmpty()
  wic_transaction_purpose?: string;

  @ValidateIf((o) => o.cif_relationship_type === "WIC")
  @IsString()
  @IsNotEmpty()
  wic_recipient_relationship?: string;

  // "Lainnya" free-text companions untuk field WIC (bila FE memakai dropdown).
  @IsOptional()
  @IsString()
  wic_transaction_purpose_other?: string;

  @IsOptional()
  @IsString()
  wic_recipient_relationship_other?: string;

  // ── RBA V01 fields ──────────────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  source_of_funds?: string;

  @IsOptional()
  @IsString()
  source_of_funds_other?: string;

  @IsOptional()
  @IsString()
  business_relationship_purpose?: string;

  @IsOptional()
  @IsString()
  business_relationship_purpose_other?: string;

  @IsOptional()
  @IsIn(["Aplikasi Digital", "Agen Pihak Ketiga", "Outlet Fisik"])
  distribution_channel?:
    "Aplikasi Digital" | "Agen Pihak Ketiga" | "Outlet Fisik";
}

/**
 * BUSINESS (KYB)
 */
export class CreateBusinessDto {
  @IsString()
  @IsNotEmpty()
  legal_name!: string;

  // PT/CV/FIRMA/KOPERASI/YAYASAN/PERKUMPULAN/PERORANGAN/BUMN_BUMD/LAINNYA
  @IsString()
  @IsNotEmpty()
  legal_form!: string;

  // Keterangan bila legal_form = "Lainnya" (tidak menggantikan nilai dropdown).
  @IsOptional()
  @IsString()
  legal_form_other?: string;

  @IsString()
  @IsNotEmpty()
  incorporation_place!: string;

  @IsDateString()
  incorporation_date!: string;

  // Nomor Izin Usaha (NIB/OSS/SIUP/dll) — cukup salah satu dari
  // business_license_number ATAU nib yang terisi. Divalidasi saat submit.
  @IsOptional()
  @IsString()
  business_license_number?: string;

  @IsOptional()
  @IsString()
  nib?: string;

  @IsString()
  @IsNotEmpty()
  npwp!: string;

  @IsString()
  @IsNotEmpty()
  address_line!: string;

  @IsString()
  @IsNotEmpty()
  city!: string;

  @IsString()
  @IsNotEmpty()
  province!: string;

  // Alamat Kedudukan — dropdown provinsi/kota (mirror Individual CDD). Opsional;
  // kolom bebas address_line/city/province tetap dipakai untuk teks alamat detail.
  @IsOptional()
  @IsString()
  business_province_code?: string;

  @IsOptional()
  @IsString()
  business_city_code?: string;

  @IsString()
  @IsNotEmpty()
  postal_code!: string;

  // Bidang Usaha — menerima nama industri RBA V01 (exact) maupun nilai legacy.
  @IsString()
  @IsNotEmpty()
  business_activity!: string;

  @IsOptional()
  @IsString()
  business_activity_other?: string;

  @IsOptional()
  @IsString()
  industry_code?: string; // KBLI

  @IsString()
  @IsNotEmpty()
  phone!: string;

  // ── Form terbaru — Informasi Identitas Badan Usaha ──────────────────
  // deed_number / nomor_akta_pendirian_perubahan_terakhir (menggantikan label
  // lama "Nomor Lisensi"). Terpisah dari business_license_number (nomor izin usaha).
  @IsOptional()
  @IsString()
  deed_number?: string;

  // email_perusahaan
  @IsOptional()
  @IsEmail()
  company_email?: string;

  // ── Pengurus Utama / Main PIC (menggantikan istilah Authorized/Representative) ─
  @IsOptional()
  @IsString()
  pic_name?: string;

  @IsOptional()
  @IsString()
  pic_position?: string;

  @IsOptional()
  @IsString()
  pic_identity_number?: string;

  @IsOptional()
  @IsIn(["KTP", "PASPOR"])
  pic_identity_type?: "KTP" | "PASPOR";

  // ── Signature / verification (opsional) ─────────────────────────────
  @IsOptional()
  @IsString()
  representative_signature_name?: string;

  @IsOptional()
  @IsString()
  verification_officer?: string;

  @IsOptional()
  @IsString()
  supervisor?: string;

  // ── RBA V01 fields ──────────────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  source_of_funds?: string;

  @IsOptional()
  @IsString()
  source_of_funds_other?: string;

  @IsOptional()
  @IsString()
  business_relationship_purpose?: string;

  @IsOptional()
  @IsString()
  business_relationship_purpose_other?: string;

  @IsOptional()
  @IsIn(["Aplikasi Digital", "Agen Pihak Ketiga", "Outlet Fisik"])
  distribution_channel?:
    "Aplikasi Digital" | "Agen Pihak Ketiga" | "Outlet Fisik";
}

/**
 * DOCUMENT metadata
 */
export class AddDocumentDto {
  // KTP,SIM,PASPOR, AKTA_PENDIRIAN,NIB_SIUP,NPWP_BADAN, KTP_KUASA,PASPOR_KUASA
  @IsString()
  @IsNotEmpty()
  doc_type!: string;

  @IsString()
  @IsNotEmpty()
  file_uri!: string;
}

export class DecisionDto {
  @IsIn(["APPROVED", "REJECTED"])
  decision!: "APPROVED" | "REJECTED";

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ListApplicationsQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  cif?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "date_from must be YYYY-MM-DD" })
  date_from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "date_to must be YYYY-MM-DD" })
  date_to?: string;

  @IsOptional()
  @IsIn(["INDIVIDUAL", "BUSINESS"])
  application_type?: "INDIVIDUAL" | "BUSINESS";

  @IsOptional()
  @IsIn([
    "DRAFT",
    "SUBMITTED",
    "IN_REVIEW",
    "ESCALATED",
    "APPROVED",
    "REJECTED",
  ])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class CreatePartyDto {
  @IsIn([
    "DIRECTOR",
    "COMMISSIONER",
    "MANAGER",
    "BO",
    "AUTHORIZED_REP",
    "SHAREHOLDER",
  ])
  role!:
    | "DIRECTOR"
    | "COMMISSIONER"
    | "MANAGER"
    | "BO"
    | "AUTHORIZED_REP"
    | "SHAREHOLDER";

  @IsString()
  @IsNotEmpty()
  full_name!: string;

  @IsIn(["KTP", "SIM", "PASPOR", "LAINNYA"])
  identity_type!: "KTP" | "SIM" | "PASPOR" | "LAINNYA";

  @IsString()
  @IsNotEmpty()
  identity_number!: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // ── Detail pemegang saham & Beneficial Owner (form terbaru) ─────────
  // Persentase kepemilikan (0–100). Dipakai shareholder & BO.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  ownership_percentage?: number;

  // Alamat party (shareholder/BO address)
  @IsOptional()
  @IsString()
  address?: string;

  // Jenis dokumen identitas (mis. KTP/PASPOR) untuk shareholder/BO
  @IsOptional()
  @IsString()
  identity_document_type?: string;

  // BO — sumber dana & sumber kekayaan
  @IsOptional()
  @IsString()
  source_of_funds?: string;

  @IsOptional()
  @IsString()
  source_of_funds_other?: string;

  @IsOptional()
  @IsString()
  source_of_wealth?: string;

  @IsOptional()
  @IsString()
  source_of_wealth_other?: string;
}
