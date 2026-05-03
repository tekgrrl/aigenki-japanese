import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TutorController } from './tutor.controller';
import { TutorService } from './tutor.service';
import { TutorToolExecutor } from './tutor-tool.executor';
import { GeminiProvider } from './providers/gemini.provider';
import { ClaudeProvider } from './providers/claude.provider';
import { AiProvider } from './providers/ai-provider.interface';
import { ScenariosModule } from '../scenarios/scenarios.module';

@Module({
  imports: [ConfigModule.forRoot(), ScenariosModule],
  controllers: [TutorController],
  providers: [
    GeminiProvider,
    ClaudeProvider,
    TutorToolExecutor,
    {
      provide: AiProvider,
      useFactory: (
        config: ConfigService,
        gemini: GeminiProvider,
        claude: ClaudeProvider,
      ): AiProvider =>
        config.get<string>('AI_PROVIDER') === 'claude' ? claude : gemini,
      inject: [ConfigService, GeminiProvider, ClaudeProvider],
    },
    TutorService,
  ],
})
export class TutorModule {}
