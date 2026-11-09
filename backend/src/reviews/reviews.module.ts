import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { GeminiModule } from 'src/gemini/gemini.module';
import { QuestionsModule } from 'src/questions/questions.module';
import { KnowledgeUnitsModule } from 'src/knowledge-units/knowledge-units.module';
import { StatsModule } from '../stats/stats.module';
import { UserKnowledgeUnitsModule } from '../user-knowledge-units/user-knowledge-units.module';
import { ScenariosModule } from '../scenarios/scenarios.module';
import { LearningProgressModule } from '../learning-progress/learning-progress.module';
import { ReviewProgressModule } from '../review-progress/review-progress.module';
import { AuthModule } from '../auth/auth.module';
import { KanjiModule } from '../kanji/kanji.module';
import { ScenarioFlashModule } from '../scenario-flash/scenario-flash.module';

@Module({
  imports: [
    GeminiModule,
    QuestionsModule,
    KnowledgeUnitsModule,
    StatsModule,
    UserKnowledgeUnitsModule,
    ScenariosModule,
    LearningProgressModule,
    ReviewProgressModule,
    AuthModule,
    KanjiModule,
    ScenarioFlashModule,
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService]
})
export class ReviewsModule { }
