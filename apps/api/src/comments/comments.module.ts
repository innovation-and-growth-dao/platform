import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';

@Module({
  imports: [AuthModule], // provides JwtAuthGuard
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
