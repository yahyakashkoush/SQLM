import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from '../errors/domain.error';

/**
 * Single place all uncaught errors funnel through. Keeps stack traces out of
 * HTTP responses (never leak internals to customers) while still logging
 * them fully server-side, and normalizes the response envelope so every
 * client (bot, mini app, admin) can parse errors the same way. Recognizes
 * `DomainError` (thrown from deep inside service-layer transactions with no
 * HTTP context of their own) and maps it to its declared status instead of
 * treating it as an unexpected 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const isDomain = exception instanceof DomainError;
    const status = isHttp
      ? exception.getStatus()
      : isDomain
        ? exception.httpStatus
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = isHttp ? exception.getResponse() : null;

    const message = isHttp
      ? typeof payload === 'string'
        ? payload
        : ((payload as Record<string, unknown>)?.message ?? exception.message)
      : isDomain
        ? exception.message
        : 'Internal server error';

    if (!isHttp && !isDomain) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (isHttp && status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      message,
      ...(isHttp && typeof payload === 'object' && payload && 'errors' in payload
        ? { errors: (payload as Record<string, unknown>).errors }
        : {}),
    });
  }
}
