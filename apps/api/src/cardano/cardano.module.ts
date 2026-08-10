import { Global, Module } from '@nestjs/common';
import { VerifyController } from './verify.controller';
import { CardanoQueryService } from './cardano-query.service';
import { AnchorService } from './anchor.service';

@Global()
@Module({
  controllers: [VerifyController],
  providers: [CardanoQueryService, AnchorService],
  exports: [CardanoQueryService, AnchorService],
})
export class CardanoModule {}
