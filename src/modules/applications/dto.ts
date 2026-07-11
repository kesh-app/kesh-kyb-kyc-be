import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * INDIVIDUAL (KYC)
 */
export class CreateIndividualDto {
  @IsString() @IsNotEmpty()
  full_name!: string;

  @IsOptional() @IsString()
  alias?: string;

  // Nomor KTP (NIK) — 15 atau 16 digit, hanya angka
  @IsString() @IsNotEmpty() @Matches(/^\d{15,16}$/, { message: 'ktp_number harus 15-16 digit angka' })
  ktp_number!: string;

  @IsOptional() @IsString() @MaxLength(20)
  sim_number?: string;

  @IsOptional() @IsString() @MaxLength(20)
  passport_number?: string;

  @IsIn(['KTP', 'SIM', 'PASPOR', 'LAINNYA'])
  identity_type!: 'KTP' | 'SIM' | 'PASPOR' | 'LAINNYA';

  @IsString() @IsNotEmpty()
  identity_number!: string;

  // Legacy: wajib untuk client lama. Bisa dikosongkan jika structured address dikirim.
  @IsOptional() @IsString()
  address_identity?: string;

  @IsOptional() @IsString()
  address_residential?: string;

  // Alamat terstruktur (opsional)
  @IsOptional() @IsString()
  province_code?: string;

  @IsOptional() @IsString()
  city_code?: string;

  @IsOptional() @IsString()
  district_code?: string;

  @IsOptional() @IsString()
  village_code?: string;

  @IsOptional() @IsString()
  street_address?: string;

  @IsOptional() @IsString() @MaxLength(50)
  house_number?: string;

  @IsOptional() @IsString() @MaxLength(20)
  rt_rw?: string;

  @IsOptional() @IsString() @MaxLength(100)
  apartment_block?: string;

  @IsOptional() @IsString()
  address_landmark?: string;

  @IsString() @IsNotEmpty()
  pob!: string;

  @IsDateString()
  dob!: string;

  @IsString() @IsNotEmpty()
  nationality!: string;

  @IsString() @IsNotEmpty()
  phone!: string;

  @IsString() @IsNotEmpty()
  occupation!: string;

  // Pekerjaan tambahan (opsional)
  @IsOptional() @IsString()
  industry_category?: string;

  @IsOptional() @IsString()
  company_name?: string;

  @IsOptional() @IsString()
  company_address?: string;

  @IsOptional() @IsString()
  monthly_income_range?: string;

  @IsIn(['M', 'F', 'O'])
  gender!: 'M' | 'F' | 'O';

  @IsOptional() @IsEmail()
  email?: string;

  // Wajib saat SUBMIT, boleh kosong saat DRAFT
  @IsOptional() @IsString()
  signature_uri?: string;

  // CIF relationship type — OUR_CUSTOMER (default) atau WIC; BO tidak diizinkan pada individual create
  @IsOptional() @IsIn(['OUR_CUSTOMER', 'WIC'])
  cif_relationship_type?: 'OUR_CUSTOMER' | 'WIC';
}

/**
 * BUSINESS (KYB)
 */
export class CreateBusinessDto {
  @IsString() @IsNotEmpty()
  legal_name!: string;

  // PT/CV/FIRMA/KOPERASI/YAYASAN/PERKUMPULAN/PERORANGAN/BUMN_BUMD/LAINNYA
  @IsString() @IsNotEmpty()
  legal_form!: string;

  @IsString() @IsNotEmpty()
  incorporation_place!: string;

  @IsDateString()
  incorporation_date!: string;

  @IsString() @IsNotEmpty()
  business_license_number!: string;

  @IsOptional() @IsString()
  nib?: string;

  @IsString() @IsNotEmpty()
  npwp!: string;

  @IsString() @IsNotEmpty()
  address_line!: string;

  @IsString() @IsNotEmpty()
  city!: string;

  @IsString() @IsNotEmpty()
  province!: string;

  @IsString() @IsNotEmpty()
  postal_code!: string;

  @IsString() @IsNotEmpty()
  business_activity!: string;

  @IsOptional() @IsString()
  industry_code?: string; // KBLI

  @IsString() @IsNotEmpty()
  phone!: string;
}

/**
 * DOCUMENT metadata
 */
export class AddDocumentDto {
  // KTP,SIM,PASPOR, AKTA_PENDIRIAN,NIB_SIUP,NPWP_BADAN, KTP_KUASA,PASPOR_KUASA
  @IsString() @IsNotEmpty()
  doc_type!: string;

  @IsString() @IsNotEmpty()
  file_uri!: string;
}

export class DecisionDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

  @IsOptional() @IsString()
  reason?: string;
}

export class ListApplicationsQueryDto {
  @IsOptional() @IsString()
  q?: string;

  @IsOptional() @IsString()
  cif?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date_from must be YYYY-MM-DD' })
  date_from?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date_to must be YYYY-MM-DD' })
  date_to?: string;

  @IsOptional() @IsIn(['INDIVIDUAL', 'BUSINESS'])
  application_type?: 'INDIVIDUAL' | 'BUSINESS';

  @IsOptional() @IsIn(['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'ESCALATED', 'APPROVED', 'REJECTED'])
  status?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit?: number;
}

export class CreatePartyDto {
  @IsIn(['DIRECTOR','COMMISSIONER','MANAGER','BO','AUTHORIZED_REP'])
  role!: 'DIRECTOR'|'COMMISSIONER'|'MANAGER'|'BO'|'AUTHORIZED_REP';

  @IsString() @IsNotEmpty()
  full_name!: string;

  @IsIn(['KTP','SIM','PASPOR','LAINNYA'])
  identity_type!: 'KTP'|'SIM'|'PASPOR'|'LAINNYA';

  @IsString() @IsNotEmpty()
  identity_number!: string;

  @IsOptional() @IsDateString()
  dob?: string;

  @IsOptional() @IsString()
  nationality?: string;

  @IsOptional() @IsString()
  phone?: string;

  @IsOptional() @IsEmail()
  email?: string;
}