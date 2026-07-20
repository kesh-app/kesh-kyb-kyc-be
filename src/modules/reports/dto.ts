import {
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export const REPORT_TYPES = ['ALL', 'KYC_KYB', 'LTKT', 'LTKM', 'TRANSFERS', 'COMPLAINTS'] as const;
export const REPORT_FORMATS = ['XLSX', 'CSV'] as const;
export const GENERATION_MODES = ['ON_DEMAND', 'SCHEDULED_DAILY', 'SCHEDULED_MONTHLY'] as const;
export const REPORT_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED'] as const;

export class GenerateReportDto {
  @IsIn(REPORT_TYPES as unknown as string[])
  report_type!: string;

  @IsIn(REPORT_FORMATS as unknown as string[])
  format!: string;

  @IsISO8601()
  period_start!: string;

  @IsISO8601()
  period_end!: string;

  @IsOptional() @IsObject()
  filters?: Record<string, any>;
}

export class ListReportsQueryDto {
  @IsOptional() @IsIn(REPORT_TYPES as unknown as string[])
  report_type?: string;

  @IsOptional() @IsIn(GENERATION_MODES as unknown as string[])
  generation_mode?: string;

  @IsOptional() @IsIn(REPORT_STATUSES as unknown as string[])
  status?: string;

  @IsOptional() @IsISO8601()
  date_from?: string;

  @IsOptional() @IsISO8601()
  date_to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit?: number;
}
