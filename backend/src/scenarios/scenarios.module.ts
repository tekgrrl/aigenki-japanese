import { Module } from '@nestjs/common';
import { ScenariosController } from './scenarios.controller';
import { ScenariosService } from './scenarios.service';
import { ScenarioChatService } from './scenario-chat.service';
import { ScenarioKnowledgeService } from './scenario-knowledge.service';
import { GeminiModule } from '../gemini/gemini.module';
import { KnowledgeUnitsModule } from '../knowledge-units/knowledge-units.module';
import { LessonsModule } from '../lessons/lessons.module';
import { UserModule } from '../users/user.module';
import { AuthModule } from '../auth/auth.module';
import { GrammarSectionsModule } from '../grammar-sections/grammar-sections.module';
import { PicturesModule } from '../pictures/pictures.module';

@Module({
  imports: [
    GeminiModule,
    KnowledgeUnitsModule,
    LessonsModule,
    UserModule,
    AuthModule,
    GrammarSectionsModule,
    PicturesModule,
  ],
  controllers: [ScenariosController],
  providers: [ScenariosService, ScenarioChatService, ScenarioKnowledgeService],
  exports: [ScenariosService],
})
export class ScenariosModule { }