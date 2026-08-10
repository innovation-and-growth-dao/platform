import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
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
  @Post('sweep')
  async sweep(@CurrentAdmin() admin: AdminIdentity) {
    const r = await this.anchor.sweepToMultisig();
    await this.audit.log({ adminId: admin.adminId, action: 'wallet.sweep', target: r.to, payload: { txHash: r.txHash } });
    return r;
  }

  // Exchange the hot-wallet seed (only allowed once swept). New address funded afresh.
  @Post('rotate-seed')
  async rotate(@CurrentAdmin() admin: AdminIdentity) {
    const r = await this.anchor.rotateSeed(admin.adminId);
    await this.audit.log({ adminId: admin.adminId, action: 'wallet.rotate-seed', target: r.address });
    return r;
  }
}
