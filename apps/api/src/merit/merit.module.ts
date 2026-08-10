import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { MeritService } from './merit.service';
import { MeritSweepService } from './merit-sweep.service';
import { MeritController } from './merit.controller';

// Global so the vote/round/treasury/milestone hooks can inject MeritService
// without each module importing it (mirrors the global PrismaModule).
@Global()
@Module({
  imports: [AuthModule],
  controllers: [MeritController],
  providers: [MeritService, MeritSweepService, BoardGuard],
  exports: [MeritService, MeritSweepService],
})
export class MeritModule {}
