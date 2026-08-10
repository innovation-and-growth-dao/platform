import { Module } from '@nestjs/common';
import { CardanoModule } from '../cardano/cardano.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { ProposalsModule } from '../proposals/proposals.module';
import { RoundsModule } from '../rounds/rounds.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [CardanoModule, TreasuryModule, ProposalsModule, RoundsModule, NotificationsModule],
  providers: [JobsService],
})
export class JobsModule {}
