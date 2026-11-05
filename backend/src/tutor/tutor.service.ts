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
  // Grammar/Concept KU seeding (sourceType === 'grammar-pattern') — parallel to the
  // Vocab-only sourceContextSentence/targetVocab pair above.
  pattern?: string;
  title?: string;
  corpusNotes?: string;
  // When true, the dialogue's vocabulary/grammar is hard-constrained to what the tutor
  // tools actually returned for this user (frontier/leech vocab, level seed, enrolled
  // grammar pool) instead of anything the model judges level-appropriate. Used for
  // sourceKuId-driven reinforcement scenarios, where introducing brand-new incidental
  // vocabulary defeats the point and needlessly raises the roleplay-readiness bar.
  strict?: boolean;
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
- Call get_grammar_patterns(jlptLevel) to see the grammar pool available for linking. Identify 1-2 patterns from those results that naturally appear in your dialogue and populate grammarMatches with a short example sentence taken directly from the conversation (with fragments for the typing exercise). Never invent a kuId — only use IDs returned by get_grammar_patterns. If no pool patterns fit the dialogue, return an empty grammarMatches array.
- When you have gathered sufficient context, call create_scenario to produce and save the output.
- You will be warned when you are on your final tool round. Heed that warning.

Language rules:
- Scenario metadata (title, description, location, goal, timeOfDay, visualPrompt) must always be written in English — never Japanese.
- Dialogue text must be plain Japanese with no parenthetical annotations. Do NOT add readings or translations inside the dialogue (e.g. never write 渋谷駅（しぶやえき）— write 渋谷駅).
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
    if (dto.sourceType === 'grammar-pattern' && dto.pattern) {
      lines.push(
        `Build this scenario around practicing the grammar pattern "${dto.pattern}"` +
        (dto.title ? ` (${dto.title})` : '') +
        `. The dialogue MUST naturally require the user to produce this pattern at least once — it is the specific thing they need practice with, not incidental content.` +
        (dto.corpusNotes ? ` Context: ${dto.corpusNotes}` : ''),
      );
    }

    const scenarioMeta: Record<string, unknown> = {};
    if (dto.sourceKuId) scenarioMeta.sourceKuId = dto.sourceKuId;
    if (dto.sourceContextSentence) scenarioMeta.sourceContextSentence = dto.sourceContextSentence;
    if (dto.sourceType) scenarioMeta.sourceType = dto.sourceType;
    if (dto.targetVocab) scenarioMeta.targetVocab = dto.targetVocab;

    // Created here (not inside run()) so the strict-mode pre-fetch below and the agent's
    // own later tool calls share one cache — no duplicate Firestore reads, and the model
    // sees exactly the same tool results we're enforcing against.
    const turnCache = new Map<string, unknown>();

    if (dto.strict) {
      const { allowedVocab, allowedGrammarKuIds } = await this.buildStrictConstraints(uid, dto, turnCache);
      scenarioMeta.strictAllowedVocab = allowedVocab;
      if (allowedGrammarKuIds) scenarioMeta.strictAllowedGrammarKuIds = allowedGrammarKuIds;
      lines.push(
        `STRICT MODE: The dialogue's content words (nouns, verbs, adjectives — not grammatical ` +
        `particles/copula like は, が, を, に, で, です, ます) MUST be chosen only from this list: ` +
        `${allowedVocab.join('、')}. Do not introduce any other vocabulary. If natural phrasing ` +
        `would require a word outside this list, simplify the sentence instead — do not reach for it.` +
        (allowedGrammarKuIds
          ? ' Likewise, grammarMatches must only use kuIds from get_grammar_patterns — no exceptions.'
          : ''),
      );
      lines.push(
        'The scenario must give the user something to review: feature at least one Vocab item from ' +
        "get_review_candidates in the user's lines, as Key Vocabulary. " +
        'Items the user already knows well may be used alongside.',
      );
    }

    return this.run(uid, [
      { role: 'user', parts: [{ type: 'text', text: lines.join('\n') }] },
    ], scenarioMeta, dto, turnCache);
  }

  /** Pre-fetches (via the same tool executor/cache the agent loop uses) the concrete
   * vocab/grammar this user actually knows, for strict mode's prompt constraint and
   * post-generation server-side filter. */
  private async buildStrictConstraints(
    uid: string,
    dto: TutorGenerateScenarioDto,
    cache: Map<string, unknown>,
  ): Promise<{ allowedVocab: string[]; allowedGrammarKuIds?: string[] }> {
    const profile = (await this.executor.execute(
      uid,
      { callId: 'strict-profile', name: 'get_user_profile', args: {} },
      cache,
    )) as { jlptLevel: string };
    const jlptLevel = dto.difficulty ?? profile.jlptLevel;

    const [frontier, leech, levelSeed, candidates] = await Promise.all([
      this.executor.execute(uid, { callId: 'strict-frontier', name: 'get_frontier_vocab', args: {} }, cache) as Promise<{ content: string }[]>,
      this.executor.execute(uid, { callId: 'strict-leech', name: 'get_leech_vocab', args: {} }, cache) as Promise<{ content: string }[]>,
      this.executor.execute(uid, { callId: 'strict-seed', name: 'get_level_seed', args: { jlptLevel } }, cache) as Promise<{ grammar: string[]; vocab: string[] }>,
      this.executor.execute(uid, { callId: 'strict-candidates', name: 'get_review_candidates', args: {} }, cache) as Promise<{ content: string; type: string }[]>,
    ]);

    const vocabSet = new Set<string>([
      ...frontier.map(e => e.content),
      ...leech.map(e => e.content),
      ...levelSeed.vocab,
      ...candidates.filter(c => c.type === 'Vocab').map(c => c.content),
    ]);
    if (dto.targetVocab) vocabSet.add(dto.targetVocab);

    let allowedGrammarKuIds: string[] | undefined;
    if (dto.sourceType === 'grammar-pattern') {
      const { patterns } = (await this.executor.execute(
        uid,
        { callId: 'strict-grammar', name: 'get_grammar_patterns', args: { jlptLevel } },
        cache,
      )) as { patterns: { kuId: string }[] };
      allowedGrammarKuIds = patterns.map(p => p.kuId);
    }

    return { allowedVocab: Array.from(vocabSet), allowedGrammarKuIds };
  }

  private async run(
    uid: string,
    initialMessages: AiMessage[],
    scenarioMeta: Record<string, unknown> = {},
    dto: TutorGenerateScenarioDto = {},
    turnCache: Map<string, unknown> = new Map(),
  ): Promise<string> {
    const start = performance.now();
    const iterationLog: { tools: string[]; results: Record<string, string>; costUsd?: number }[] = [];

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

    const messages: AiMessage[] = [...initialMessages];
    let scenarioId: string | null = null;
    let totalCostUsd = 0;

    try {
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        this.logger.log(`iteration ${iteration + 1}/${MAX_ITERATIONS} uid=${uid}`);

        const response = await this.aiProvider.chat({
          system: SYSTEM_PROMPT,
          messages,
          tools: TOOL_REGISTRY,
        });
        totalCostUsd += response.costUsd ?? 0;

        if (response.type === 'end_turn') {
          if (scenarioId) {
            await this.apilogService.completeLog(logRef, {
              status: 'success',
              durationMs: Math.round(performance.now() - start),
              responseData: {
                scenarioId,
                iterationCount: iteration + 1,
                iterations: iterationLog,
                costUsd: totalCostUsd,
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
          costUsd: response.costUsd,
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
          totalCostUsd += confirm.costUsd ?? 0;
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
              costUsd: totalCostUsd,
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
