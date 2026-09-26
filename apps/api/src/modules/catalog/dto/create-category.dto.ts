import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateCategoryDto {
  /** Generated from `name` when omitted. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase English letters, numbers and hyphens',
  })
  slug?: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @IsOptional()
  @IsIn(['ACTIVE', 'HIDDEN'])
  status?: 'ACTIVE' | 'HIDDEN';
}
