import { Module, Global, forwardRef } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { QuestionsController } from './questions.controller';
import { GeminiModule } from '../gemini/gemini.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { KnowledgeUnitsModule } from '../knowledge-units/knowledge-units.module';
@Global()
@Module({
    providers: [QuestionsService],
    exports: [QuestionsService],
    controllers: [QuestionsController],
    imports: [KnowledgeUnitsModule, GeminiModule,
        forwardRef(() => ReviewsModule)],
})
export class QuestionsModule { }
