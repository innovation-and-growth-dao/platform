import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActivityTracker } from './activity.tracker';
import { ActivityInterceptor } from './activity.interceptor';
import { DeployController } from './deploy.controller';
import { MaintenanceController } from './maintenance.controller';

/**
 * §26 — deploy-guard support: a global request-activity tracker + a token-gated readiness probe
 * the deploy script polls to avoid deploying while someone is using the platform.
 */
@Module({
  controllers: [DeployController, MaintenanceController],
  providers: [
    ActivityTracker,
    { provide: APP_INTERCEPTOR, useClass: ActivityInterceptor },
  ],
})
export class DeployModule {}
