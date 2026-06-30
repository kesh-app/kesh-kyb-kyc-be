// src/modules/users/admin.dto.ts
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export const INTERNAL_ROLES = [
  'SystemAdmin',
  'BranchAdmin',
  'FrontDesk',
  'ComplianceLead',
  'Auditor',
  'FinanceStaff',
  'FinanceManager',
] as const;

export type InternalRole = (typeof INTERNAL_ROLES)[number];

export class CreateAdminUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  fullName!: string; // sesuaikan dengan nama kolom di DB (full_name)

  @IsIn(INTERNAL_ROLES as any)
  role!: InternalRole;

  @IsOptional()
  @IsInt()
  @Min(1)
  branchId?: number;

  @IsString()
  password!: string;
}

export class UpdateAdminUserDto {
  @IsOptional()
  @IsIn(INTERNAL_ROLES as any)
  role?: InternalRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  branchId?: number | null;
}
