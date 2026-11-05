import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { StepUpGuard } from './step-up.guard';
import { CurrentAdmin } from './current-admin.decorator';
import type { AdminIdentity } from './admin-auth.service';
import { AdminAuditService } from './admin-audit.service';
import { AnchorService } from '../cardano/anchor.service';

/**
 * §18/§23 — platform-admin management of the anchor hot wallet (DReps/board do not
 * touch this). Move funds to the multisig, then exchange the seed. Admin-only + audited.
 */
@Controller('sysadmin/wallet')
@UseGuards(AdminGuard)
export class SysadminWalletController {
  constructor(
    private readonly anchor: AnchorService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  status() {
    return this.anchor.walletStatus();
  }

  // Sweep ALL hot-wallet funds to the treasury (multisig).
  @UseGuards(StepUpGuard)
  @Post('sweep')
  async sweep(@CurrentAdmin() admin: AdminIdentity) {
    const r = await this.anchor.sweepToMultisig();
    await this.audit.log({ adminId: admin.adminId, action: 'wallet.sweep', target: r.to, payload: { txHash: r.txHash } });
    return r;
  }

  // Exchange the hot-wallet seed (only allowed once swept). New address funded afresh.
  @UseGuards(StepUpGuard)
  @Post('rotate-seed')
  async rotate(@CurrentAdmin() admin: AdminIdentity) {
    const r = await this.anchor.rotateSeed(admin.adminId);
    await this.audit.log({ adminId: admin.adminId, action: 'wallet.rotate-seed', target: r.address });
    return r;
  }

  @Patch('anchor-config')
  async setAnchorConfig(@CurrentAdmin() admin: AdminIdentity, @Body() dto: { mode?: 'scheduled' | 'immediate'; sweepHours?: number }) {
    const mode = dto.mode !== undefined ? await this.anchor.setAnchorMode(dto.mode) : await this.anchor.getAnchorMode();
    const sweepHours = dto.sweepHours !== undefined ? await this.anchor.setSweepHours(Number(dto.sweepHours)) : await this.anchor.getSweepHours();
    await this.audit.log({ adminId: admin.adminId, action: 'wallet.anchor-config', payload: { mode, sweepHours } });
    return { mode, sweepHours };
  }

  @UseGuards(StepUpGuard)
  @Post('submit-anchors')
  async submitAnchors(@CurrentAdmin() admin: AdminIdentity) {
    const r = await this.anchor.submitAllPending();
    await this.audit.log({ adminId: admin.adminId, action: 'wallet.submit-anchors', payload: { submitted: r.submitted, failed: r.failed, total: r.total } });
    return r;
  }
}
