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
 * Authorizes Expert / Submitter application review. The board can always review; while no board is
 * seated (§14 open-admission bootstrap), an admitted Council member can too — so these applications,
 * which always need a human approval, are never stuck with nobody able to act. Run AFTER JwtAuthGuard.
 */
@Injectable()
export class ApplicationReviewGuard implements CanActivate {
  constructor(private readonly board: BoardService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user?: AuthContext }>();
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedException('not authenticated');
    if (!(await this.board.canReviewApplications(userId))) {
      throw new ForbiddenException('only the board — or, while no board is seated, an admitted Council member — can review applications');
    }
    return true;
  }
}
