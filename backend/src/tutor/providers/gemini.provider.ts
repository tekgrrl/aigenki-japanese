import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Content, Part } from '@google/genai';
import { randomUUID } from 'crypto';
import {
  AiProvider,
  AiMessage,
  AiMessagePart,
  AiToolDefinition,
  AiToolCall,
  AiResponse,
} from './ai-provider.interface';

@Injectable()
export class GeminiProvider extends AiProvider implements OnModuleInit {
  private readonly logger = new Logger(GeminiProvider.name);
  private client: GoogleGenAI;
  private modelName: string;
  get modelLabel(): string { return this.modelName; }

  constructor(private readonly configService: ConfigService) { super(); }

  onModuleInit() {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY')!;
    this.modelName =
      this.configService.get<string>('MODEL_GEMINI_FLASH') ?? 'gemini-2.0-flash';
    this.client = new GoogleGenAI({ apiKey });
  }

  async chat({
    system,
    messages,
    tools,
  }: {
    system: string;
    messages: AiMessage[];
    tools: AiToolDefinition[];
  }): Promise<AiResponse> {
    const contents: Content[] = messages.map(msg => this.toContent(msg));

    const functionDeclarations = tools.map(t => ({
      name: t.name,
      description: t.description,
      parametersJsonSchema: t.parameters,
    }));

    this.logger.debug(`chat: ${messages.length} messages, ${tools.length} tools`);

    const response = await this.client.models.generateContent({
      model: this.modelName,
      contents,
      config: {
        systemInstruction: system,
        tools: [{ functionDeclarations }],
      },
    });

    const calls = response.functionCalls;
    if (calls && calls.length > 0) {
      const toolCalls: AiToolCall[] = calls.map((c, i) => ({
        callId: c.id ?? `call_${i}_${randomUUID()}`,
        name: c.name!,
        args: (c.args ?? {}) as Record<string, unknown>,
      }));

      // Preserve the raw Gemini Content (including thought_signature) so the
      // next turn can send it back verbatim rather than reconstructing it.
      const rawContent = response.candidates?.[0]?.content;
      const modelTurn: AiMessage = {
        role: 'model',
        parts: toolCalls.map(c => ({
          type: 'tool_call' as const,
          callId: c.callId,
          name: c.name,
          args: c.args,
        })),
        _raw: rawContent,
      };

      this.logger.debug(`tool_use: ${toolCalls.map(c => c.name).join(', ')}`);
      return { type: 'tool_use', calls: toolCalls, modelTurn };
    }

    const text = response.text ?? '';
    this.logger.debug(`end_turn: ${text.length} chars`);
    return { type: 'end_turn', content: text };
  }

  private toContent(msg: AiMessage): Content {
    // Use the raw provider content when available — preserves thought_signature
    if (msg._raw) return msg._raw as Content;
    return {
      role: msg.role,
      parts: msg.parts.map(p => this.toPart(p)),
    };
  }

  private toPart(part: AiMessagePart): Part {
    switch (part.type) {
      case 'text':
        return { text: part.text };
      case 'tool_call':
        return {
          functionCall: {
            id: part.callId,
            name: part.name,
            args: part.args,
          },
        };
      case 'tool_result':
        return {
          functionResponse: {
            id: part.callId,
            name: part.name,
            response: this.wrapResult(part.result),
          } as any,
        };
    }
  }

  private wrapResult(result: unknown): Record<string, unknown> {
    if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
      return result as Record<string, unknown>;
    }
    return { value: result };
  }
}
