import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateComplaintDto {
  @Type(() => Number) @IsInt() @Min(1)
  customer_application_id!: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  transfer_id?: number;

  @IsString() @IsNotEmpty() @MaxLength(100)
  transaction_reference!: string;

  @IsOptional() @IsIn(['TRANSFER', 'KYC_DATA', 'DOCUMENT', 'SERVICE', 'OTHER'])
  category?: string;

  @IsOptional() @IsIn(['WALK_IN', 'WHATSAPP', 'EMAIL', 'PHONE', 'OTHER'])
  channel?: string;

  @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  priority?: string;

  @IsString() @IsNotEmpty() @MinLength(10) @MaxLength(5000)
  complaint_notes!: string;
}

export class UpdateComplaintDto {
  @IsOptional() @IsIn(['TRANSFER', 'KYC_DATA', 'DOCUMENT', 'SERVICE', 'OTHER'])
  category?: string;

  @IsOptional() @IsIn(['WALK_IN', 'WHATSAPP', 'EMAIL', 'PHONE', 'OTHER'])
  channel?: string;

  @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  priority?: string;

  @IsOptional() @IsString() @MinLength(10) @MaxLength(5000)
  complaint_notes?: string;

  @IsOptional() @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'])
  status?: string;

  @IsOptional() @IsString() @MaxLength(5000)
  resolution_notes?: string;
}

export class ListComplaintsQueryDto {
  @IsOptional() @IsString()
  q?: string;

  @IsOptional() @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'])
  status?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  customer_application_id?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit?: number;
}
