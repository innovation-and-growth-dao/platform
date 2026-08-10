import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { ProposalsModule } from '../proposals/proposals.module';
import { RoundsService } from './rounds.service';
import { RoundsSchedulerService } from './rounds-scheduler.service';
import { RoundsController } from './rounds.controller';
import { AdminRoundsController } from './admin-rounds.controller';

@Module({
  // §8 — needs DvService so the round-transition flow can auto-(re)open D&V
  // voting on every DEBATE_VOTE-stage proposal when the round enters VOTE.
  imports: [AuthModule, forwardRef(() => ProposalsModule)],
  controllers: [RoundsController, AdminRoundsController],
  providers: [RoundsService, RoundsSchedulerService, BoardGuard],
  exports: [RoundsService],
})
export class RoundsModule {}
