import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthService, type AdminIdentity } from './admin-auth.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminGuard } from './admin.guard';
import { StepUpGuard } from './step-up.guard';
import { CurrentAdmin } from './current-admin.decorator';
import { AcceptInviteDto, AdminInviteDto } from './dto';

// §18.5 / §26.6 — admin account management.
@Controller('sysadmin/admins')
export class SysadminAdminsController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly audit: AdminAuditService,
  ) {}

  @UseGuards(AdminGuard, StepUpGuard)
  @Post('invite')
  async invite(@CurrentAdmin() admin: AdminIdentity, @Body() dto: AdminInviteDto) {
    const { token, expiresAt } = await this.auth.createInvitation(admin.adminId, dto.username, dto.email);
    await this.audit.log({ adminId: admin.adminId, action: 'ADMIN_INVITED', target: dto.username });
    return { token, expiresAt };
  }

  // No guard — the invitee is not yet an admin.
  @Post('accept-invite')
  async accept(@Body() dto: AcceptInviteDto, @Req() req: Request) {
    const result = await this.auth.acceptInvitation(dto.token, dto.password);
    await this.audit.log({
      adminId: result.adminId,
      action: 'ADMIN_ACCEPTED_INVITE',
      ip: req.ip,
    });
    return {
      adminId: result.adminId,
      totpUri: result.totpUri,
      totpBase32: result.totpBase32,
      totpQrDataUrl: result.totpQrDataUrl,
      recoveryCodes: result.recoveryCodes,
    };
  }

  @UseGuards(AdminGuard, StepUpGuard)
  @Post(':id/remove')
  async remove(@CurrentAdmin() admin: AdminIdentity, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.removeAdmin(id);
    await this.audit.log({ adminId: admin.adminId, action: 'ADMIN_REMOVED', target: id });
    return { ok: true };
  }

  @UseGuards(AdminGuard, StepUpGuard)
  @Post(':id/disable')
  async disable(@CurrentAdmin() admin: AdminIdentity, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.disableAdmin(id);
    await this.audit.log({ adminId: admin.adminId, action: 'ADMIN_DISABLED', target: id });
    return { ok: true };
  }

  /** §18.8 — generate a one-time password-reset token for another admin (1h TTL, shown once). */
  @UseGuards(AdminGuard, StepUpGuard)
  @Post(':id/password-reset')
  async passwordReset(@CurrentAdmin() admin: AdminIdentity, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.auth.createPasswordReset(admin.adminId, id);
    await this.audit.log({ adminId: admin.adminId, action: 'ADMIN_PASSWORD_RESET_ISSUED', target: r.username });
    return r;
  }

  // No guard — the target admin uses the one-time token.
  @Post('reset-password')
  async resetPassword(@Body() dto: { token: string; password: string }, @Req() req: Request) {
    const r = await this.auth.resetPassword(dto.token, dto.password);
    await this.audit.log({ adminId: null, action: 'ADMIN_PASSWORD_RESET_USED', ip: req.ip });
    return r;
  }

  /** §18.6 — switch ALL admins: invite the new roster; old roster auto-disabled when the last invite is accepted. */
  @UseGuards(AdminGuard, StepUpGuard)
  @Post('switch-all')
  async switchAll(@CurrentAdmin() admin: AdminIdentity, @Body() dto: { admins: { username: string; email: string }[] }) {
    const r = await this.auth.switchAllAdmins(admin.adminId, dto.admins ?? []);
    await this.audit.log({ adminId: admin.adminId, action: 'ADMIN_SWITCH_ALL_STARTED', target: (dto.admins ?? []).map((a) => a.username).join(', ') });
    return r;
  }
}
