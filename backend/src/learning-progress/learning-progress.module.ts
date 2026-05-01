import { Global, Module } from '@nestjs/common';
import { LearningProgressService } from './learning-progress.service';
import { UserKnowledgeUnitsModule } from '../user-knowledge-units/user-knowledge-units.module';

@Global()
@Module({
    imports: [UserKnowledgeUnitsModule],
    providers: [LearningProgressService],
    exports: [LearningProgressService],
})
export class LearningProgressModule {}
