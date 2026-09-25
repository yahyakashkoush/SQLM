import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface AuthenticatedStaff {
  id: string;
  email: string;
  role: string;
}

/** Pulled from the request by `JwtStaffAuthGuard` (Passport's `jwt-staff` strategy). */
export const CurrentStaff = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedStaff => {
    const request = ctx.switchToHttp().getRequest();
    return request.staff;
  },
);
