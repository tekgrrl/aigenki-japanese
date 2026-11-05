import { Module } from '@nestjs/common';
import { DailyPlanController } from './daily-plan.controller';
import { DailyPlanService } from './daily-plan.service';
import { FirebaseModule } from '../firebase/firebase.module';
import { StatsModule } from '../stats/stats.module';

@Module({
  imports: [FirebaseModule, StatsModule],
  controllers: [DailyPlanController],
  providers: [DailyPlanService],
  exports: [DailyPlanService],
})
export class DailyPlanModule {}
