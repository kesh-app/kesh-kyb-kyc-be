import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateTransferDto {
  @IsInt() @Min(1)
  amount!: number;

  @IsString()
  beneficiaryBankName!: string;

  @IsOptional() @IsString()
  beneficiaryBankCode?: string;
  
  @IsInt()
  sender_application_id!: number;

  @IsString()
  beneficiaryAccountNumber!: string;

  @IsString()
  beneficiaryAccountName!: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsDateString()
  requestedTransferAt?: string; // YYYY-MM-DD
}

export class UpdateTransferDto extends CreateTransferDto {}

export class DecideTransferDto {
  @IsString()
  decision!: 'APPROVE' | 'REJECT';

  @IsOptional() @IsString()
  note?: string;
}

export class SetTransferResultDto {
  @IsString()
  result!: 'SUCCESS' | 'FAILED';

  @IsOptional() @IsString()
  note?: string;

  @IsOptional() @IsString()
  attachmentUri?: string;
}
