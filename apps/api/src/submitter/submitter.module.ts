import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { ApplicationReviewGuard } from '../auth/application-review.guard';
import { SubmitterService } from './submitter.service';
import { BoardSubmittersController, DaoSubmittersController, MeSubmitterController } from './submitter.controller';

@Module({
  imports: [AuthModule],
  controllers: [MeSubmitterController, BoardSubmittersController, DaoSubmittersController],
  providers: [SubmitterService, BoardGuard, ApplicationReviewGuard],
  exports: [SubmitterService],
})
export class SubmitterModule {}
