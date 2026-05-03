import { Injectable } from '@nestjs/common';
import { AiProvider, AiMessage, AiToolDefinition, AiResponse } from './ai-provider.interface';

@Injectable()
export class ClaudeProvider extends AiProvider {
  readonly modelLabel = 'claude';
  async chat(_params: {
    system: string;
    messages: AiMessage[];
    tools: AiToolDefinition[];
  }): Promise<AiResponse> {
    throw new Error('ClaudeProvider is not yet implemented. Set AI_PROVIDER=gemini.');
  }
}
