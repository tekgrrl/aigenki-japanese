import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ReviewsModule } from './reviews/reviews.module';
import { FirebaseModule } from './firebase/firebase.module';
import { GeminiModule } from './gemini/gemini.module';
import { ConfigModule } from '@nestjs/config';
import { QuestionsService } from './questions/questions.service';
import { QuestionsModule } from './questions/questions.module';
import { ApilogModule } from './apilog/apilog.module';
import { LessonsModule } from './lessons/lessons.module';
import { KnowledgeUnitsModule } from './knowledge-units/knowledge-units.module';
import { StatsModule } from './stats/stats.module';
import { KanjiModule } from './kanji/kanji.module';
import { ScenariosModule } from './scenarios/scenarios.module';
import { AudioModule } from './audio/audio.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './users/user.module';
import { UserKnowledgeUnitsModule } from './user-knowledge-units/user-knowledge-units.module';
import { ConceptsModule } from './concepts/concepts.module';
import { LearningProgressModule } from './learning-progress/learning-progress.module';
import { TutorModule } from './tutor/tutor.module';
import { DailyPlanModule } from './daily-plan/daily-plan.module';

@Module({
  imports: [ReviewsModule, FirebaseModule, GeminiModule, ConfigModule.forRoot(), QuestionsModule, ApilogModule, LessonsModule, KnowledgeUnitsModule, StatsModule, KanjiModule, ScenariosModule, AudioModule, AuthModule, UserModule, UserKnowledgeUnitsModule, ConceptsModule, LearningProgressModule, TutorModule, DailyPlanModule],
  controllers: [AppController],
  providers: [AppService, QuestionsService],
})
export class AppModule { }
