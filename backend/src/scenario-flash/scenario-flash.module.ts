import { Module } from '@nestjs/common';
import { ScenarioFlashService } from './scenario-flash.service';
import { KnowledgeUnitsModule } from '../knowledge-units/knowledge-units.module';
import { ScenariosModule } from '../scenarios/scenarios.module';
import { DailyPlanModule } from '../daily-plan/daily-plan.module';
import { TutorModule } from '../tutor/tutor.module';

@Module({
  imports: [KnowledgeUnitsModule, ScenariosModule, DailyPlanModule, TutorModule],
  providers: [ScenarioFlashService],
  exports: [ScenarioFlashService],
})
export class ScenarioFlashModule {}
