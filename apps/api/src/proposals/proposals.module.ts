import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { ProposalsService } from './proposals.service';
import { FilteringService } from './filtering.service';
import { DvService } from './dv.service';
import { ProposalsController } from './proposals.controller';
import { AdminProposalsController } from './admin-proposals.controller';
import { FilteringController } from './filtering.controller';
import { DvController } from './dv.controller';
import { QuickPollService } from './quick-poll.service';
import { QuickPollController } from './quick-poll.controller';

@Module({
  imports: [AuthModule],
  controllers: [ProposalsController, AdminProposalsController, FilteringController, DvController, QuickPollController],
  providers: [ProposalsService, FilteringService, DvService, QuickPollService, BoardGuard],
  exports: [ProposalsService, DvService, QuickPollService],
})
export class ProposalsModule {}
