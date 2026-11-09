import { Module, Global } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { QuestionsController } from './questions.controller';
import { GeminiModule } from '../gemini/gemini.module';
import { KnowledgeUnitsModule } from '../knowledge-units/knowledge-units.module';
import { StatsModule } from '../stats/stats.module';
@Global()
@Module({
    providers: [QuestionsService],
    exports: [QuestionsService],
    controllers: [QuestionsController],
    imports: [KnowledgeUnitsModule, GeminiModule, StatsModule],
})
export class QuestionsModule { }
