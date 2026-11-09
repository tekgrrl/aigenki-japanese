import { Inject, Injectable, Logger } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION } from '../firebase/firebase.module';
import { UserKnowledgeUnitsService } from '../user-knowledge-units/user-knowledge-units.service';
import { TutorContextService } from '../tutor-context/tutor-context.service';
import { UserRoot } from '../types';
import { storedJlptLevel } from './user.service';

/**
 * Keeps what depends on the learner's level in step with it after a level save: each enrolment's
 * `aboveLevel` flag and the allowed-grammar list.
 *
 * - One run at a time per account (an in-memory chain), so two quick saves can't interleave.
 * - Each run uses the level stored when it starts, so the last run always matches the last save.
 * - `aboveLevelComputedFor` on the user doc records the level the last successful run applied:
 *   a run for that same level is skipped, and after a failure the next save runs again.
 *
 * The chain is per process; with several backend instances two runs could still overlap.
 */
@Injectable()
export class LevelSyncService {
  private readonly logger = new Logger(LevelSyncService.name);
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly userKnowledgeUnitsService: UserKnowledgeUnitsService,
    private readonly tutorContext: TutorContextService,
  ) {}

  /** Brings the account's level-dependent data up to its stored level. Never throws: failures are logged. */
  async syncToStoredLevel(uid: string): Promise<void> {
    const previous = this.running.get(uid) ?? Promise.resolve();
    const run = previous.then(() => this.sync(uid)).catch(e => {
      this.logger.error(`Level sync failed for uid=${uid}; it will run again on the next level save`, e);
    });
    this.running.set(uid, run);
    await run;
    if (this.running.get(uid) === run) this.running.delete(uid);
  }

  private async sync(uid: string): Promise<void> {
    const userRef = this.db.collection('users').doc(uid);
    const user = (await userRef.get()).data() as (UserRoot & { aboveLevelComputedFor?: string }) | undefined;
    const level = storedJlptLevel(user);
    if (!level || user?.aboveLevelComputedFor === level) return;
    await this.userKnowledgeUnitsService.recomputeAboveLevel(uid, level);
    await this.tutorContext.rebuildAllowedGrammarKuIds(uid, level);
    await userRef.set({ aboveLevelComputedFor: level }, { merge: true });
  }
}
