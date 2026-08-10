import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { ProposalMessagesService } from './proposal-messages.service';
import { ProposalMessagesController } from './proposal-messages.controller';

@Module({
  imports: [AuthModule],
  controllers: [ProposalMessagesController],
  providers: [ProposalMessagesService, BoardGuard],
  exports: [ProposalMessagesService],
})
export class ProposalMessagesModule {}
