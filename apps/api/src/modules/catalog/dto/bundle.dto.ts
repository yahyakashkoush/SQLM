import { OmitType, PartialType } from '@nestjs/mapped-types';
import { ProductBundleDto } from './create-product.dto';

/** One bundle, saved on its own — never as part of a whole-list replace. */
export class CreateBundleDto extends OmitType(ProductBundleDto, ['id'] as const) {}

export class UpdateBundleDto extends PartialType(CreateBundleDto) {}
