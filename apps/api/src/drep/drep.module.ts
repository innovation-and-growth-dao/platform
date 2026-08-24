import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { ApplicationReviewGuard } from '../auth/application-review.guard';
import { DrepService } from './drep.service';
import { MeDrepController } from './me-drep.controller';
import { MeExpertController } from './me-expert.controller';
import { BoardAdmissionController } from './board-admission.controller';
import { BoardExpertsController } from './board-experts.controller';
import { BoardRemovalController } from './board-removal.controller';
import { DaoController } from './dao.controller';
import { BoardProofsController } from './board-proofs.controller';

@Module({
  imports: [AuthModule], // provides JwtAuthGuard
  controllers: [
    MeDrepController,
    MeExpertController,
    BoardAdmissionController,
    BoardExpertsController,
    BoardRemovalController,
    DaoController,
    BoardProofsController,
  ],
  providers: [DrepService, BoardGuard, ApplicationReviewGuard],
})
export class DrepModule {}
