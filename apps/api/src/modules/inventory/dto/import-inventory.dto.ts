import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength } from 'class-validator';

export class ImportInventoryDto {
  /** Plaintext secrets (e.g. "email:password" or a license key) — encrypted before storage, never logged. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(4000, { each: true })
  secrets!: string[];
}
