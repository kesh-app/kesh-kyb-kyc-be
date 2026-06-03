import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * INDIVIDUAL (KYC)
 */
export class CreateIndividualDto {
  @IsString() @IsNotEmpty()
  full_name!: string;

  @IsIn(['KTP', 'SIM', 'PASPOR', 'LAINNYA'])
  identity_type!: 'KTP' | 'SIM' | 'PASPOR' | 'LAINNYA';

  @IsString() @IsNotEmpty()
  identity_number!: string;

  @IsString() @IsNotEmpty()
  address_identity!: string;

  @IsOptional() @IsString()
  address_residential?: string;

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

  @IsIn(['M', 'F', 'O'])
  gender!: 'M' | 'F' | 'O';

  @IsOptional() @IsEmail()
  email?: string;

  // Wajib saat SUBMIT, boleh kosong saat DRAFT
  @IsOptional() @IsString()
  signature_uri?: string;
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

  @IsString() @IsNotEmpty()
  nib!: string;

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