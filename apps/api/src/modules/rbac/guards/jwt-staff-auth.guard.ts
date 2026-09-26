import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Wraps Passport's `jwt-staff` strategy and attaches the result to
 * `request.staff` (not the default `request.user`) so it can never be
 * confused with a customer principal on a route that — by mistake —
 * ends up reachable from both guard types.
 */
@Injectable()
export class JwtStaffAuthGuard extends AuthGuard('jwt-staff') {
  override handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthorizedException('Invalid or expired staff session');
    }
    const request = context.switchToHttp().getRequest();
    request.staff = user;
    return user;
  }
}
