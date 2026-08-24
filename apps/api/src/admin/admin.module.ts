import { Module } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminService } from './admin.service';
import { GenesisService } from './genesis.service';
import { AdminGuard } from './admin.guard';
import { SysadminAuthController } from './sysadmin-auth.controller';
import { SysadminGenesisController } from './sysadmin-genesis.controller';
import { SysadminOpsController } from './sysadmin-ops.controller';
import { SysadminAdminsController } from './sysadmin-admins.controller';
import { SysadminWalletController } from './sysadmin-wallet.controller';
import { ResetController } from './reset.controller';
import { ResetService } from './reset.service';
import { SysadminMaintenanceController } from './sysadmin-maintenance.controller';

@Module({
  controllers: [
    SysadminAuthController,
    SysadminGenesisController,
    SysadminOpsController,
    SysadminAdminsController,
    SysadminWalletController,
    ResetController,
    SysadminMaintenanceController,
  ],
  providers: [AdminAuthService, AdminAuditService, AdminService, GenesisService, AdminGuard, ResetService],
  exports: [AdminAuthService],
})
export class AdminModule {}
