import { Module } from '@nestjs/common';
import { PublicConfigController } from './public-config.controller';
import { PublicOverviewController } from './public-overview.controller';
import { RoundsModule } from '../rounds/rounds.module';
import { TreasuryModule } from '../treasury/treasury.module';

@Module({
  imports: [RoundsModule, TreasuryModule],
  controllers: [PublicConfigController, PublicOverviewController],
})
export class PublicConfigModule {}
