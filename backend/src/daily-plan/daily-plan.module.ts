import { Module } from '@nestjs/common';
import { DailyPlanController } from './daily-plan.controller';
import { DailyPlanService } from './daily-plan.service';
import { FirebaseModule } from '../firebase/firebase.module';

@Module({
  imports: [FirebaseModule],
  controllers: [DailyPlanController],
  providers: [DailyPlanService],
})
export class DailyPlanModule {}
