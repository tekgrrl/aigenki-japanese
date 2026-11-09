import { Body, Controller, Get, Patch, Req, UseGuards, Logger } from '@nestjs/common';
import { UserService } from './user.service';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { UserId } from '../auth/user-id.decorator';
import { AllowIncompleteProfile } from '../auth/allow-incomplete-profile.decorator';
import { UserKnowledgeUnitsService } from '../user-knowledge-units/user-knowledge-units.service';
import { StatsService } from '../stats/stats.service';

@Controller('users')
@UseGuards(FirebaseAuthGuard)
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    private readonly userService: UserService,
    private readonly userKnowledgeUnitsService: UserKnowledgeUnitsService,
    private readonly statsService: StatsService,
  ) {}

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
  @AllowIncompleteProfile()
  async getOrInitializeMe(@UserId() uid: string, @Req() req: any) {
    this.logger.log(`GET /users/me called for uid: ${uid}`);
    const user = await this.userService.findOrCreate(uid, req.user?.email);
    return user;
  }

  /**
   * PATCH /api/users/me/preferences
   *
   * Persists user-facing preferences (e.g. furigana toggle) to the UserRoot document.
   * Uses Firestore merge so unknown fields are preserved. Saving the level also completes the
   * profile, and re-derives which enrolments are above it (aboveLevel, allowed grammar) before
   * answering, so the app the learner lands on already uses the new level.
   */
  @Patch('me/preferences')
  @AllowIncompleteProfile()
  async updatePreferences(
    @UserId() uid: string,
    @Body() body: { showFurigana?: boolean; jlptLevel?: string; preferredUserRole?: string; audioFirstExperiment?: boolean },
  ) {
    // The level as stored before this save (not getJlptLevel: "unset" must count as a change).
    const previousLevel = body.jlptLevel ? (await this.userService.findById(uid))?.preferences?.jlptLevel : undefined;
    await this.userService.updatePreferences(uid, body);
    if (body.jlptLevel && body.jlptLevel !== previousLevel) {
      // The level is saved and the profile complete either way; a failure here leaves some flags
      // stale until the next level change, which is better than reporting the save as failed.
      try {
        await this.userKnowledgeUnitsService.recomputeAboveLevel(uid, body.jlptLevel);
        await this.statsService.rebuildAllowedGrammarKuIds(uid);
      } catch (e) {
        this.logger.error(`Level saved for uid=${uid}, but recomputing aboveLevel / allowed grammar failed`, e);
      }
    }
    return { ok: true };
  }
}
