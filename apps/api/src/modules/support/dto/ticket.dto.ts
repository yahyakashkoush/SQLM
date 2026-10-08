import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TICKET_CATEGORIES, TICKET_STATUSES, type TicketCategory, type TicketStatus } from '@sqlm/shared';

export class CreateTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;

  @IsOptional()
  @IsIn(TICKET_CATEGORIES)
  category?: TicketCategory;

  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export class AddTicketMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;

  /** Staff-only: a note other agents can see but the customer never does. */
  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}

export class TicketQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: TicketStatus;

  @IsOptional()
  @IsUUID()
  assignedStaffId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unassigned?: boolean;
}

export class AssignTicketDto {
  /** null unassigns. */
  @IsOptional()
  @IsUUID()
  staffId?: string;
}

export class SetTicketStatusDto {
  @IsIn(TICKET_STATUSES)
  status!: TicketStatus;
}
