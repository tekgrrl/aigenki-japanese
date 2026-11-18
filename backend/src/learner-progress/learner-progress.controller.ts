import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { UserId } from '../auth/user-id.decorator';
import { LearnerProgressService } from './learner-progress.service';

/** The learner's own progress: per KU, and the verb-form skills grid (shown on /admin/progress). */
@Controller('learner-progress')
@UseGuards(FirebaseAuthGuard)
export class LearnerProgressController {
  constructor(private readonly learnerProgress: LearnerProgressService) {}

  @Get('verb-forms')
  verbForms(@UserId() uid: string) {
    return this.learnerProgress.verbFormGrid(uid);
  }

  @Get('ku/:kuId')
  forKu(@UserId() uid: string, @Param('kuId') kuId: string) {
    return this.learnerProgress.forKu(uid, kuId);
  }
}
