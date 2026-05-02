import { Global, Module } from '@nestjs/common';
import { UserKnowledgeUnitsService } from './user-knowledge-units.service';
import { StatsModule } from '../stats/stats.module';

@Global()
@Module({
  imports: [StatsModule],
  providers: [UserKnowledgeUnitsService],
  exports: [UserKnowledgeUnitsService],
})
export class UserKnowledgeUnitsModule {}
