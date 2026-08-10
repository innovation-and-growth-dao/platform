import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { GovernanceService } from './governance.service';
import { GovernanceController } from './governance.controller';

@Module({
  imports: [AuthModule],
  controllers: [GovernanceController],
  providers: [GovernanceService, BoardGuard],
})
export class GovernanceModule {}
