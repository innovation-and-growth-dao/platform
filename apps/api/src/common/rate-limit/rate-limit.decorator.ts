import { SetMetadata } from '@nestjs/common';

// SEC-05 — declarative, Redis-backed request budgets applied per annotated route.
// `by` selects the identity dimension; a route may carry several rules (e.g. per-IP AND
// per-stake). A rule whose identity can't be resolved for a given request is skipped, so
// annotating a route never hard-fails a well-formed call.
export type RateLimitBy = 'ip' | 'session' | 'stakeBody' | 'accountBody';

export interface RateLimitRule {
  points: number; // allowed hits within the window
  durationSec: number; // window length
  by: RateLimitBy;
  failClosed?: boolean; // deny (not allow) if Redis is unreachable — for privileged endpoints
}

export const RATE_LIMIT_KEY = 'sec05_rate_limit_rules';
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMIT_KEY, rules);
