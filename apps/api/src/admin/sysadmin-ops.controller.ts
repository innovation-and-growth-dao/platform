import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

// §18.9 / §26.6 — read-only dashboard data. Admin-only.
@Controller('sysadmin')
@UseGuards(AdminGuard)
export class SysadminOpsController {
  constructor(private readonly admin: AdminService) {}

  @Get('health')
  health() {
    return this.admin.health();
  }

  @Get('admins')
  admins() {
    return this.admin.listAdmins();
  }

  @Get('audit-log')
  auditLog(@Query('limit') limit?: string) {
    return this.admin.auditLog(limit ? Number(limit) : 50);
  }
}
