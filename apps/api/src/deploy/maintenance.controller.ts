import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'node:fs';

/**
 * §26 — public "maintenance is about to start" signal. The deploy-guard writes a
 * `<MAINTENANCE_FLAG>.pending` file holding the epoch-seconds at which maintenance will begin
 * (~60s ahead), then waits, so the frontend can warn connected users to finish their work before
 * the platform briefly goes offline. Reachable during the warning window (the real maintenance
 * gate isn't up yet).
 */
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly config: ConfigService) {}

  @Get('status')
  status(): { pending: boolean; secondsLeft: number } {
    const flag = this.config.get<string>('MAINTENANCE_FLAG');
    const pendingPath = flag ? `${flag}.pending` : null;
    if (!pendingPath || !existsSync(pendingPath)) return { pending: false, secondsLeft: 0 };
    try {
      const target = Number(readFileSync(pendingPath, 'utf8').trim());
      if (!Number.isFinite(target)) return { pending: false, secondsLeft: 0 };
      const secondsLeft = Math.max(0, Math.round(target - Date.now() / 1000));
      return { pending: secondsLeft > 0, secondsLeft };
    } catch {
      return { pending: false, secondsLeft: 0 };
    }
  }
}
