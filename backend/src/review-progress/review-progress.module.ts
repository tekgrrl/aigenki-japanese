import { Global, Module } from '@nestjs/common';
import { ReviewProgressService } from './review-progress.service';
import { KnowledgeUnitsModule } from '../knowledge-units/knowledge-units.module';
import { LessonsModule } from '../lessons/lessons.module';
import { UserKnowledgeUnitsModule } from '../user-knowledge-units/user-knowledge-units.module';
import { GeminiModule } from '../gemini/gemini.module';
import { StatsModule } from '../stats/stats.module';

@Global()
@Module({
  imports: [KnowledgeUnitsModule, LessonsModule, UserKnowledgeUnitsModule, GeminiModule, StatsModule],
  providers: [ReviewProgressService],
  exports: [ReviewProgressService],
})
export class ReviewProgressModule {}
