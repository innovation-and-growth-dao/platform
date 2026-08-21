import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { SubcategoriesController } from './subcategories.controller';
import { SubcategoriesService } from './subcategories.service';

// §5.3 — board-configurable expertise subcategories. AuthModule provides AuthService/BoardService;
// BoardGuard is listed here so Nest can instantiate it for the board-only routes (PrismaService is
// global).
@Module({
  imports: [AuthModule],
  controllers: [SubcategoriesController],
  providers: [SubcategoriesService, BoardGuard],
})
export class SubcategoriesModule {}
