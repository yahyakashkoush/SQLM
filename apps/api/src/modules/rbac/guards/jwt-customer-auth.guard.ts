import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Wraps Passport's `jwt-customer` strategy and attaches the result to `request.customer`. */
@Injectable()
export class JwtCustomerAuthGuard extends AuthGuard('jwt-customer') {
  override handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthorizedException('Invalid or expired session');
    }
    const request = context.switchToHttp().getRequest();
    request.customer = user;
    return user;
  }
}
