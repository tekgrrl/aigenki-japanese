import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { UserKnowledgeUnitsService } from '../user-knowledge-units/user-knowledge-units.service';
import { TutorContextService } from '../tutor-context/tutor-context.service';

export type LearnerFlagKuType = 'Vocab' | 'Grammar';
export type LearnerFlagChoice = 'exclude' | 'enroll';

@Injectable()
export class LearnerFlagsService {
  private readonly logger = new Logger(LearnerFlagsService.name);

  constructor(
    private readonly knowledgeUnitsService: KnowledgeUnitsService,
    private readonly userKnowledgeUnitsService: UserKnowledgeUnitsService,
    private readonly tutorContext: TutorContextService,
  ) {}

  /**
   * Handles the two-choice flag flow from issue #222: "Not now" excludes the
   * content from future incidental use (lessons/reviews/scenarios, forward-only
   * — see quiz/vocab/grammar/scenario prompt call sites for enforcement).
   * "Help me learn this" enrolls it into the learning queue — the choice itself
   * is the confirmation, so no further prompt is needed on this path.
   */
  async flag(
    uid: string,
    content: string,
    kuType: LearnerFlagKuType,
    choice: LearnerFlagChoice,
    context?: string,
  ): Promise<{ status: 'excluded' | 'enrolled'; kuId?: string }> {
    if (!content?.trim()) {
      throw new BadRequestException('content is required');
    }

    if (choice === 'exclude') {
      if (kuType === 'Vocab') {
        await this.tutorContext.addToExcludedVocab(uid, content);
      } else {
        await this.tutorContext.addToExcludedGrammar(uid, content);
      }
      this.logger.log(`Excluded ${kuType} "${content}" for uid=${uid} (context=${context ?? 'unknown'})`);
      return { status: 'excluded' };
    }

    // choice === 'enroll'
    const kuId = await this.findOrCreateKu(content, kuType);
    if (!kuId) {
      // Grammar is a closed, curated corpus — never invent new Grammar KUs.
      // If a flagged pattern isn't already in the corpus, there's nothing to enroll.
      this.logger.warn(`No corpus match for Grammar "${content}", nothing to enroll (uid=${uid})`);
      throw new BadRequestException(`No matching Grammar pattern found for "${content}"`);
    }

    await this.userKnowledgeUnitsService.create(uid, kuId, { type: 'flag', id: context ?? 'unknown' });
    this.logger.log(`Enrolled ${kuType} "${content}" (kuId=${kuId}) for uid=${uid} via flag flow`);
    return { status: 'enrolled', kuId };
  }

  private async findOrCreateKu(content: string, kuType: LearnerFlagKuType): Promise<string | null> {
    const existing = await this.knowledgeUnitsService.findByContent(content, kuType);
    if (existing) return existing.id;

    if (kuType === 'Vocab') {
      return this.knowledgeUnitsService.ensureVocab(content);
    }

    return null;
  }
}
