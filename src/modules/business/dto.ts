import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const PARTY_ROLES = [
  'DIRECTOR',
  'COMMISSIONER',
  'MANAGER',
  'BO',
  'AUTHORIZED_REP',
  'SHAREHOLDER',
] as const;
type PartyRole = (typeof PARTY_ROLES)[number];

export class CreateBusinessPartyWithPersonDto {
  // role di entitas
  @IsIn(PARTY_ROLES as unknown as string[])
  role!: PartyRole;

  // data person minimal (KYC individu ringkas)
  @IsString() @IsNotEmpty() full_name!: string;
  @IsIn(['KTP','SIM','PASPOR','LAINNYA']) identity_type!: 'KTP'|'SIM'|'PASPOR'|'LAINNYA';
  @IsString() @IsNotEmpty() identity_number!: string;
  @IsString() @IsNotEmpty() address_identity!: string;

  @IsString() @IsNotEmpty() pob!: string;
  @IsDateString() dob!: string;
  @IsString() @IsNotEmpty() nationality!: string;
  @IsString() @IsNotEmpty() phone!: string;
  @IsIn(['M','F','O']) gender!: 'M'|'F'|'O';

  @IsOptional() @IsString() occupation?: string;
  @IsOptional() @IsString() email?: string;

  // ── Detail pemegang saham & Beneficial Owner (form terbaru) ──────────
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  ownership_percentage?: number;

  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() identity_document_type?: string;
  @IsOptional() @IsString() source_of_funds?: string;
  @IsOptional() @IsString() source_of_funds_other?: string;
  @IsOptional() @IsString() source_of_wealth?: string;
  @IsOptional() @IsString() source_of_wealth_other?: string;
}

export class LinkExistingPersonDto {
  @IsIn(PARTY_ROLES as unknown as string[])
  role!: PartyRole;

  @IsNotEmpty() person_id!: number;
}

export class UpdatePartyActiveDto {
  is_active!: boolean;
}
