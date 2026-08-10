import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { SessionPayload } from './auth.service';

export interface AuthContext {
  userId: string;
  stakeKeyHash: string;
  payload: SessionPayload;
}

/** Injects the authenticated context attached by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    return ctx.switchToHttp().getRequest().user as AuthContext;
  },
);
