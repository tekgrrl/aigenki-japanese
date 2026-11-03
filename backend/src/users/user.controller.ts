import { Body, Controller, Get, Patch, Req, UseGuards, Logger } from '@nestjs/common';
import { UserService } from './user.service';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { UserId } from '../auth/user-id.decorator';

@Controller('users')
@UseGuards(FirebaseAuthGuard)
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(private readonly userService: UserService) {}

  /**
   * GET /api/users/me
   *
   * Initialization endpoint. The frontend should call this once on app load.
   * - If the user's UserRoot document exists, it is returned as-is.
   * - If it does not exist, a default is created and returned.
   *
   * Idempotent — safe to call every time the app loads.
   */
  @Get('me')
  async getOrInitializeMe(@UserId() uid: string, @Req() req: any) {
    this.logger.log(`GET /users/me called for uid: ${uid}`);
    const user = await this.userService.findOrCreate(uid, req.user?.email);
    return user;
  }

  /**
   * PATCH /api/users/me/preferences
   *
   * Persists user-facing preferences (e.g. furigana toggle) to the UserRoot document.
   * Uses Firestore merge so unknown fields are preserved.
   */
  @Patch('me/preferences')
  async updatePreferences(
    @UserId() uid: string,
    @Body() body: { showFurigana?: boolean; jlptLevel?: string; preferredUserRole?: string; audioFirstExperiment?: boolean },
  ) {
    await this.userService.updatePreferences(uid, body);
    return { ok: true };
  }
}
