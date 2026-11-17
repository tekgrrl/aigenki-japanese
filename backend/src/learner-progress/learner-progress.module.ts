import { Global, Module } from '@nestjs/common';
import { LearnerProgressController } from './learner-progress.controller';
import { LearnerProgressService } from './learner-progress.service';

@Global()
@Module({
  controllers: [LearnerProgressController],
  providers: [LearnerProgressService],
  exports: [LearnerProgressService],
})
export class LearnerProgressModule {}
