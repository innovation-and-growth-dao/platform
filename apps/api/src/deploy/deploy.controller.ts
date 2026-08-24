import { Controller, ForbiddenException, Get, Headers, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityTracker } from './activity.tracker';

/**
 * §26 — deploy-guard readiness probe. Reports whether the platform is currently in use so the
 * deploy script can wait for a quiet moment before entering maintenance mode. Unprefixed
 * (/internal/…, excluded from the api/v1 prefix in main.ts) and gated by a shared DEPLOY_TOKEN
 * so the activity picture isn't public. Only ever called from the server itself over localhost.
 */
@Controller()
export class DeployController {
  constructor(
    private readonly tracker: ActivityTracker,
    private readonly config: ConfigService,
  ) {}

  @Get('internal/deploy/readiness')
  readiness(@Headers('x-deploy-token') token: string | undefined, @Query('windowSec') windowSec?: string) {
    const expected = this.config.get<string>('DEPLOY_TOKEN');
    if (!expected || token !== expected) throw new ForbiddenException('deploy token required');
    const w = Math.max(5, Math.min(600, Number(windowSec) || 45));
    return this.tracker.snapshot(w);
  }
}
