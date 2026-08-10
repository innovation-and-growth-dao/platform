import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { BoardGuard } from '../auth/board.guard';
import { MilestonesService } from './milestones.service';
import { MilestonesController } from './milestones.controller';

@Module({
  imports: [AuthModule, TreasuryModule], // TreasuryModule exports TreasuryBucketsService for default-bucket routing
  controllers: [MilestonesController],
  providers: [MilestonesService, BoardGuard],
})
export class MilestonesModule {}
