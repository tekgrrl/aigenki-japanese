import { Module } from '@nestjs/common';
import { ScenarioFlashService } from './scenario-flash.service';
import { KnowledgeUnitsModule } from '../knowledge-units/knowledge-units.module';
import { ScenariosModule } from '../scenarios/scenarios.module';
import { StatsModule } from '../stats/stats.module';
import { TutorModule } from '../tutor/tutor.module';

@Module({
  imports: [KnowledgeUnitsModule, ScenariosModule, StatsModule, TutorModule],
  providers: [ScenarioFlashService],
  exports: [ScenarioFlashService],
})
export class ScenarioFlashModule {}
