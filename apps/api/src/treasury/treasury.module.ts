import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CardanoModule } from '../cardano/cardano.module';
import { BoardGuard } from '../auth/board.guard';
import { TreasuryService } from './treasury.service';
import { TreasuryController } from './treasury.controller';
import { BoardMultisigService } from './board-multisig.service';
import { BoardMultisigController } from './board-multisig.controller';
import { MultisigBroadcastService } from './multisig-broadcast.service';
import { TreasuryBucketsService } from './treasury-buckets.service';
import { PledgeReturnService } from './pledge-return.service';
import { TreasuryBucketsController } from './treasury-buckets.controller';

@Module({
  imports: [AuthModule, CardanoModule],
  controllers: [TreasuryController, BoardMultisigController, TreasuryBucketsController],
  providers: [TreasuryService, BoardMultisigService, MultisigBroadcastService, TreasuryBucketsService, PledgeReturnService, BoardGuard],
  exports: [BoardMultisigService, TreasuryBucketsService, PledgeReturnService],
})
export class TreasuryModule {}
