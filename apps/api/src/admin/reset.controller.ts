import { Body, Controller, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { IsString } from 'class-validator';
import { AdminGuard } from './admin.guard';
import { CurrentAdmin } from './current-admin.decorator';
import type { AdminIdentity } from './admin-auth.service';
import { AdminAuditService } from './admin-audit.service';
import { ResetService } from './reset.service';

export class ResetConfirmDto {
  /** Typed exactly to prevent fat-finger destruction. */
  @IsString() confirm!: string;
}

/**
 * §23 — destructive admin reset endpoint. Requires the operator to type a
 * specific phrase in the request body so a misclick or stolen session
 * cookie can't wipe production. Audited.
 */
@Controller('sysadmin/reset')
@UseGuards(AdminGuard)
export class ResetController {
  constructor(
    private readonly reset: ResetService,
    private readonly audit: AdminAuditService,
  ) {}

  @Post()
  async run(@CurrentAdmin() admin: AdminIdentity, @Body() dto: ResetConfirmDto) {
    if (dto.confirm !== 'RESET DAO STATE') {
      throw new BadRequestException('to confirm, send { "confirm": "RESET DAO STATE" }');
    }
    const r = await this.reset.wipeAll();
    await this.audit.log({ adminId: admin.adminId, action: 'reset.dao-state', payload: r });
    return r;
  }
}
