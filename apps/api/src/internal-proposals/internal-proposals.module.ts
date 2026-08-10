import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InternalProposalsService } from './internal-proposals.service';
import { InternalProposalsController } from './internal-proposals.controller';

@Module({
  imports: [AuthModule],
  controllers: [InternalProposalsController],
  providers: [InternalProposalsService],
  exports: [InternalProposalsService],
})
export class InternalProposalsModule {}
