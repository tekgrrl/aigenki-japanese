import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { GeminiModule } from 'src/gemini/gemini.module';
import { forwardRef } from '@nestjs/common';
import { QuestionsModule } from 'src/questions/questions.module';
import { KnowledgeUnitsModule } from 'src/knowledge-units/knowledge-units.module';
import { StatsModule } from '../stats/stats.module';
import { UserKnowledgeUnitsModule } from '../user-knowledge-units/user-knowledge-units.module';
import { ScenariosModule } from '../scenarios/scenarios.module';
import { LearningProgressModule } from '../learning-progress/learning-progress.module';

@Module({
  imports: [
    GeminiModule,
    forwardRef(() => QuestionsModule),
    KnowledgeUnitsModule,
    StatsModule,
    UserKnowledgeUnitsModule,
    ScenariosModule,
    LearningProgressModule,
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService]
})
export class ReviewsModule { }
