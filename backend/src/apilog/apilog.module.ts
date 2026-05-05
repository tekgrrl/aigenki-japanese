import { Global, Module } from '@nestjs/common';
import { ApilogService } from './apilog.service';
import { ApilogController } from './apilog.controller';
import { GeminiModule } from '../gemini/gemini.module';

@Global()
@Module({
  imports: [GeminiModule],
  controllers: [ApilogController],
  providers: [ApilogService],
  exports: [ApilogService]
})
export class ApilogModule { }
