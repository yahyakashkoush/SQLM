import { HttpStatus } from '@nestjs/common';

/**
 * Base for internal service-layer errors that cross a transaction/module
 * boundary as plain `Error`s (not `HttpException`s, since the throwing code
 * — e.g. `InventoryService`, deep inside a Prisma transaction — has no HTTP
 * context and shouldn't need one). `AllExceptionsFilter` recognizes any
 * `DomainError` and maps it to `httpStatus` with a clean client-facing
 * message, instead of logging it as an unexpected 500.
 */
export abstract class DomainError extends Error {
  abstract readonly httpStatus: HttpStatus;
}
