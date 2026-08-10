import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { BoardService } from './board.service';
import type { AuthContext } from './current-user.decorator';

/**
 * Authorizes board-only endpoints (§25.5): the current user's CIP-95 DRep key
 * hash must match a genesis board seat (§17.5). Run AFTER JwtAuthGuard.
 */
@Injectable()
export class BoardGuard implements CanActivate {
  constructor(private readonly board: BoardService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user?: AuthContext }>();
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedException('not authenticated');

    if (!(await this.board.isBoardMember(userId))) throw new ForbiddenException('board members only');
    return true;
  }
}
