import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { AdminGuard } from './admin.guard';
import { CurrentAdmin } from './current-admin.decorator';
import type { AdminIdentity } from './admin-auth.service';
import { AdminAuditService } from './admin-audit.service';

/**
 * §26 — let a sysadmin put the platform into (or out of) "Short maintenance mode" on demand,
 * independent of a deploy. Backed by the SAME flag file the reverse proxy checks and the
 * deploy-guard script toggles: creating it makes Caddy serve the maintenance page to everyone
 * (the admin panel + its API are exempted from the gate, so the admin can always switch it off).
 */
@Controller('sysadmin/maintenance')
@UseGuards(AdminGuard)
export class SysadminMaintenanceController {
  constructor(
    private readonly config: ConfigService,
    private readonly audit: AdminAuditService,
  ) {}

  private flagPath(): string {
    return this.config.get<string>('MAINTENANCE_FLAG') || path.join(process.cwd(), 'MAINTENANCE');
  }

  private async status(): Promise<{ enabled: boolean; since: string | null }> {
    try {
      const st = await fs.stat(this.flagPath());
      return { enabled: true, since: st.mtime.toISOString() };
    } catch {
      return { enabled: false, since: null };
    }
  }

  @Get()
  get() {
    return this.status();
  }

  @Post('enable')
  async enable(@CurrentAdmin() admin: AdminIdentity) {
    await fs.writeFile(this.flagPath(), `maintenance on — ${new Date().toISOString()}\n`, 'utf8');
    await this.audit.log({ adminId: admin.adminId, action: 'maintenance.enable' });
    return this.status();
  }

  @Post('disable')
  async disable(@CurrentAdmin() admin: AdminIdentity) {
    await fs.rm(this.flagPath(), { force: true });
    await this.audit.log({ adminId: admin.adminId, action: 'maintenance.disable' });
    return this.status();
  }
}
