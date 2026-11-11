import { Module, Global } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { QuestionsAdminService } from './questions-admin.service';
import { QuestionsController } from './questions.controller';
import { GeminiModule } from '../gemini/gemini.module';
import { KnowledgeUnitsModule } from '../knowledge-units/knowledge-units.module';
import { AuthModule } from '../auth/auth.module';
@Global()
@Module({
    providers: [QuestionsService, QuestionsAdminService],
    exports: [QuestionsService],
    controllers: [QuestionsController],
    imports: [KnowledgeUnitsModule, GeminiModule, AuthModule],
})
export class QuestionsModule { }
