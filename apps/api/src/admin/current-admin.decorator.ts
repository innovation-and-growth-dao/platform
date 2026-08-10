import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AdminIdentity } from './admin-auth.service';

/** Injects the admin identity attached by AdminGuard. */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminIdentity => {
    return ctx.switchToHttp().getRequest().admin as AdminIdentity;
  },
);
