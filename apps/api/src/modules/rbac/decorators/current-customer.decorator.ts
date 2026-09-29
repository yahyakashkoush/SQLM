import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface AuthenticatedCustomer {
  id: string;
  telegramId: string;
}

/** Pulled from the request by `JwtCustomerAuthGuard` (Passport's `jwt-customer` strategy). */
export const CurrentCustomer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedCustomer => {
    const request = ctx.switchToHttp().getRequest();
    return request.customer;
  },
);
