import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Timestamp } from 'firebase-admin/firestore';
import { performance } from 'perf_hooks';
import { AiProvider, AiMessage, AiMessagePart } from './providers/ai-provider.interface';
import { TutorToolExecutor } from './tutor-tool.executor';
import { TOOL_REGISTRY } from './tutor-tool.registry';
import { ApilogService } from '../apilog/apilog.service';

export class TutorGenerateScenarioDto {
  theme?: string;
  difficulty?: string;
  userRole?: string;
  aiRole?: string;
  sourceType?: string;
  sourceContextSentence?: string;
  targetVocab?: string;
  sourceKuId?: string;
}

const MAX_ITERATIONS = 5;

const FINAL_ROUND_WARNING =
  'This is your final opportunity to call tools. You MUST call create_scenario now to produce the scenario. Do not request any more data.';

const SYSTEM_PROMPT = `You are a personal Japanese tutor AI. Your job is to create personalised learning content for this specific user based on their live progress data.

You have access to tools that fetch data about this user from the app backend. Use them — do not guess at the user's level, vocabulary, or grammar knowledge.

Guidelines:
- Always call get_user_profile first to establish the JLPT level and communication style.
- Call get_frontier_vocab and get_allowed_grammar to understand what the user currently knows.
- If either returns empty, call get_level_seed with the user's jlptLevel and use that as your constraint baseline. Do not invent grammar or vocabulary outside the baseline.
- Use frontier_vocab items where natural; do not force them into the dialogue.
- If the user has leech_vocab, weave repair opportunities into the content.
- Keep output at the user's jlptLevel unless a specific difficulty is stated in the request.
- When you have gathered sufficient context, call create_scenario to produce and save the output.
- You will be warned when you are on your final tool round. Heed that warning.

Dialogue rules:
- Write dialogue text as plain Japanese with no parenthetical annotations. Do NOT add readings or translations inside the dialogue (e.g. never write 渋谷駅（しぶやえき）— write 渋谷駅).
- Readings belong only in extractedKUs[].reading — not in the dialogue text.
- The user's lines must only use vocabulary and grammar that matches their level. Unfamiliar words in the user's lines defeat the purpose of the exercise.
- The AI character's lines may use slightly harder vocabulary, but should still be comprehensible at the user's level.`;

@Injectable()
export class TutorService {
  private readonly logger = new Logger(TutorService.name);

  constructor(
    private readonly aiProvider: AiProvider,
    private readonly executor: TutorToolExecutor,
    private readonly apilogService: ApilogService,
  ) {}

  async generateScenario(uid: string, dto: TutorGenerateScenarioDto): Promise<string> {
    const lines: string[] = [
      'Generate a personalised Japanese learning scenario for this user.',
    ];

    if (dto.difficulty) {
      lines.push(`Target JLPT difficulty: ${dto.difficulty}. Use this level even if the user's profile shows something different.`);
    }
    if (dto.theme) {
      lines.push(`Theme: ${dto.theme}`);
    }
    if (dto.userRole) {
      lines.push(`The user plays as: ${dto.userRole}`);
    }
    if (dto.aiRole) {
      lines.push(`The AI plays as: ${dto.aiRole}`);
    }
    if (dto.sourceContextSentence) {
      lines.push(`Base the scenario on this context sentence: "${dto.sourceContextSentence}"`);
    }
    if (dto.targetVocab) {
      lines.push(`The scenario should naturally feature this vocabulary word: ${dto.targetVocab}`);
    }

    const scenarioMeta: Record<string, unknown> = {};
    if (dto.sourceKuId) scenarioMeta.sourceKuId = dto.sourceKuId;
    if (dto.sourceContextSentence) scenarioMeta.sourceContextSentence = dto.sourceContextSentence;
    if (dto.sourceType) scenarioMeta.sourceType = dto.sourceType;
    if (dto.targetVocab) scenarioMeta.targetVocab = dto.targetVocab;

    return this.run(uid, [
      { role: 'user', parts: [{ type: 'text', text: lines.join('\n') }] },
    ], scenarioMeta, dto);
  }

  private async run(
    uid: string,
    initialMessages: AiMessage[],
    scenarioMeta: Record<string, unknown> = {},
    dto: TutorGenerateScenarioDto = {},
  ): Promise<string> {
    const start = performance.now();
    const iterationLog: { tools: string[]; results: Record<string, string> }[] = [];

    const logRef = await this.apilogService.startLog({
      timestamp: Timestamp.now(),
      route: '/api/tutor/generate-scenario',
      status: 'pending',
      modelUsed: this.aiProvider.modelLabel,
      requestData: {
        systemPrompt: SYSTEM_PROMPT,
        userMessage: (initialMessages[0]?.parts[0] as any)?.text ?? '',
        uid,
        ...dto,
      },
    });

    const turnCache = new Map<string, unknown>();
    const messages: AiMessage[] = [...initialMessages];
    let scenarioId: string | null = null;

    try {
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        this.logger.log(`iteration ${iteration + 1}/${MAX_ITERATIONS} uid=${uid}`);

        const response = await this.aiProvider.chat({
          system: SYSTEM_PROMPT,
          messages,
          tools: TOOL_REGISTRY,
        });

        if (response.type === 'end_turn') {
          if (scenarioId) {
            await this.apilogService.completeLog(logRef, {
              status: 'success',
              durationMs: Math.round(performance.now() - start),
              responseData: {
                scenarioId,
                iterationCount: iteration + 1,
                iterations: iterationLog,
              } as any,
            });
            return scenarioId;
          }
          throw new InternalServerErrorException(
            'Tutor AI ended the conversation without creating a scenario.',
          );
        }

        // Append the model turn exactly as the provider returned it.
        // modelTurn carries _raw provider content (e.g. Gemini thought_signature)
        // so we never reconstruct it and lose provider-specific metadata.
        messages.push(response.modelTurn);

        // Execute all tool calls concurrently.
        // For create_scenario, merge in metadata the AI doesn't need to know about
        // (sourceKuId, sourceType, etc.) before passing to the executor.
        const results = await Promise.all(
          response.calls.map(async call => {
            const effectiveCall =
              call.name === 'create_scenario' && Object.keys(scenarioMeta).length > 0
                ? { ...call, args: { ...call.args, ...scenarioMeta } }
                : call;
            const result = await this.executor.execute(uid, effectiveCall, turnCache);
            if (call.name === 'create_scenario') {
              scenarioId = (result as { id: string }).id;
            }
            return { callId: call.callId, name: call.name, result };
          }),
        );

        iterationLog.push({
          tools: response.calls.map(c => c.name),
          results: Object.fromEntries(
            results.map(r => [r.name, summariseResult(r.result)]),
          ),
        });

        // Build user reply with tool results
        const resultParts: AiMessagePart[] = results.map(r => ({
          type: 'tool_result' as const,
          callId: r.callId,
          name: r.name,
          result: r.result,
        }));

        // Inject warning on the round before the last allowed round
        if (iteration === MAX_ITERATIONS - 2) {
          resultParts.push({ type: 'text', text: FINAL_ROUND_WARNING });
        }

        messages.push({ role: 'user', parts: resultParts });

        // If scenario was just created, get AI's end_turn confirmation and return
        if (scenarioId) {
          const confirm = await this.aiProvider.chat({
            system: SYSTEM_PROMPT,
            messages,
            tools: TOOL_REGISTRY,
          });
          if (confirm.type !== 'end_turn') {
            this.logger.warn('AI called more tools after create_scenario — ignoring');
          }
          await this.apilogService.completeLog(logRef, {
            status: 'success',
            durationMs: Math.round(performance.now() - start),
            responseData: {
              scenarioId,
              iterationCount: iteration + 1,
              iterations: iterationLog,
            } as any,
          });
          return scenarioId;
        }
      }

      throw new InternalServerErrorException(
        `Tutor AI exceeded ${MAX_ITERATIONS} iterations without creating a scenario.`,
      );
    } catch (error: any) {
      await this.apilogService.completeLog(logRef, {
        status: 'error',
        durationMs: Math.round(performance.now() - start),
        errorData: { message: error.message, stack: error.stack },
      });
      throw error;
    }
  }
}

function summariseResult(result: unknown): string {
  if (result === null || result === undefined) return 'null';
  if (Array.isArray(result)) return `[${result.length} items]`;
  if (typeof result === 'string') return result.slice(0, 120);
  if (typeof result === 'object') {
    const s = JSON.stringify(result);
    return s.length > 200 ? s.slice(0, 200) + '…' : s;
  }
  return String(result);
}
