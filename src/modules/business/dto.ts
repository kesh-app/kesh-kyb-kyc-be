import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateBusinessPartyWithPersonDto {
  // role di entitas
  @IsIn(['DIRECTOR','COMMISSIONER','MANAGER','BO','AUTHORIZED_REP'])
  role!: 'DIRECTOR'|'COMMISSIONER'|'MANAGER'|'BO'|'AUTHORIZED_REP';

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
}

export class LinkExistingPersonDto {
  @IsIn(['DIRECTOR','COMMISSIONER','MANAGER','BO','AUTHORIZED_REP'])
  role!: 'DIRECTOR'|'COMMISSIONER'|'MANAGER'|'BO'|'AUTHORIZED_REP';

  @IsNotEmpty() person_id!: number;
}

export class UpdatePartyActiveDto {
  is_active!: boolean;
}
