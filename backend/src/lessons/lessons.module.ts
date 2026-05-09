import { Module } from '@nestjs/common';
import { LessonsService } from './lessons.service';
import { LessonsController } from './lessons.controller';
import { GeminiModule } from '../gemini/gemini.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [GeminiModule, AuthModule],
  providers: [LessonsService],
  controllers: [LessonsController],
  exports: [LessonsService],
})
export class LessonsModule { }
