import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

export class TicketClosedError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(ticketId: string) {
    super(`Ticket ${ticketId} is closed — open a new ticket to continue`);
    this.name = 'TicketClosedError';
  }
}
