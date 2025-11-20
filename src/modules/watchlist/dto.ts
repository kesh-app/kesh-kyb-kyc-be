import { IsIn, IsOptional, IsString } from 'class-validator';

export class UploadWatchlistDto {
  @IsIn(['PEP','DTTOT','PPPSPM'])
  list_type!: 'PEP'|'DTTOT'|'PPPSPM';

  @IsString()
  list_source!: string; // PPATK/UN/BNPT/Internal, dll

  @IsOptional() @IsString()
  overwrite_strategy?: 'merge' | 'replace'; // default: merge
}
