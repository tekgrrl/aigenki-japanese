import { Module } from '@nestjs/common';
import { LearnerFlagsController } from './learner-flags.controller';
import { LearnerFlagsService } from './learner-flags.service';

@Module({
  controllers: [LearnerFlagsController],
  providers: [LearnerFlagsService],
})
export class LearnerFlagsModule {}
