import {
  Injectable,
  Logger,
  OnModuleInit,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, FunctionDeclaration, FunctionCallingConfigMode, createPartFromFunctionResponse, Content, GenerateContentResponse } from '@google/genai';
import { ApiLog, Lesson, ScenarioEvaluation } from '@/types';
import { Timestamp } from 'firebase-admin/firestore';
import { ApilogService } from '../apilog/apilog.service';
import { performance } from "perf_hooks"; // For timing
import { buildKanjiDetailsSystemPrompt, buildKanjiDetailsUserMessage, buildUsageBuildMessage } from '../prompts/vocab.prompts';
import { buildScenarioEvaluatorPrompt } from '../prompts/evaluation.prompts';
import { buildSegmentationPrompt, SEGMENTATION_RESPONSE_SCHEMA } from '../prompts/pronunciation.prompts';
import { buildFuriganaMessage } from '../prompts/grammar.prompts';
import {
  PictureBrief,
  PictureBriefInput,
  PictureStyle,
  PICTURE_STYLES,
  buildFreePictureBriefMessage,
  PICTURE_BRIEF_SCHEMA,
  PICTURE_TEXT_CHECK_PROMPT,
  PICTURE_TEXT_CHECK_SCHEMA,
  buildPictureBriefMessage,
  buildPictureImagePrompt,
} from '../prompts/picture.prompts';


/** api-logs errorData for anything thrown: message and stack for an Error, the serialised value otherwise. */
function errorDataOf(error: unknown): NonNullable<ApiLog['errorData']> {
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  try {
    return { message: 'Non-Error exception', rawError: JSON.stringify(error, null, 2) };
  } catch {
    return { message: 'Non-Error exception', rawError: 'Unstringifiable error' };
  }
}

@Injectable()
export class GeminiService implements OnModuleInit {
  private readonly logger = new Logger(GeminiService.name);

  private client: GoogleGenAI;
  private modelName: string;
  private conceptModelName: string;
  private proModelName: string;
  private imageModelName: string;

  constructor(
    private configService: ConfigService,
    private apilogService: ApilogService,
  ) { }

  onModuleInit() {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    this.modelName = this.configService.get<string>('MODEL_GEMINI_FLASH') || 'gemini-3-flash-preview';
    this.conceptModelName = this.configService.get<string>('GEMINI_MODEL') || this.modelName;
    this.proModelName = this.configService.get<string>('MODEL_GEMINI_PRO') || 'gemini-3.1-pro-preview';
    this.imageModelName = this.configService.get<string>('MODEL_GEMINI_IMAGE') || 'gemini-3.1-flash-image';
    this.logger.log(`Using Gemini model: ${this.modelName}`);
    this.logger.log(`Using Gemini concept model: ${this.conceptModelName}`);

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined in environment variables');
    }

    this.client = new GoogleGenAI({ apiKey });
  }

  async evaluateAnswer(
    systemPrompt: string,
    userAnswer: string,
    expectedAnswers: string[],
    logContext?: Record<string, any>,
    /** Vocab meaning card: the usage ids the answer may match; the response then names one (or "none"). */
    usageIds?: string[],
  ) {
    const requestData = {
      userMessage: systemPrompt,
      input_userAnswer: logContext?.userAnswer,
      input_expectedAnswer: logContext?.expectedAnswers,
      input_question: logContext?.question,
      input_topic: logContext?.topic,
    };
    return this.logged('/reviews/evaluate', this.modelName, requestData, async () => {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [{ parts: [{ text: `User Answer: ${userAnswer}\nExpected: ${JSON.stringify(expectedAnswers)}` }] }],
        config: {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          responseMimeType: 'application/json',
          responseSchema: {
            type: "OBJECT",
            properties: {
              result: { type: "STRING", enum: ["pass", "fail"] },
              explanation: { type: "STRING" },
              ...(usageIds ? { usageId: { type: "STRING", enum: [...usageIds, "none"] }, misspelled: { type: "BOOLEAN" } } : {}),
            },
            required: ["result", "explanation", ...(usageIds ? ["usageId", "misspelled"] : [])],
          },
        },
      });
      const parsedJson = this.parseJson<{ result: "pass" | "fail"; explanation: string; usageId?: string; misspelled?: boolean }>(this.textOf(response));
      return { result: parsedJson, responseData: { rawText: response.text, parsedJson } };
    }).catch(error => { throw this.serverError(error); });
  }

  async generateLesson(
    userMessage: string,
    logContext?: Record<string, any>,
    cachedContentName?: string,
  ) {
    if (logContext?.content) {
      this.logger.log(`Generating lesson for content: "${logContext.content}" (Cache: ${cachedContentName || 'None'})`);
    }
    const requestData = { userMessage, content: logContext?.content, kuId: logContext?.kuId };
    const lessonString = await this.logged('/lessons/generate', this.modelName, requestData, async () => {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [{ parts: [{ text: userMessage }] }],
        config: {
          responseMimeType: "application/json",
          temperature: 0.4,
          cachedContent: cachedContentName,
        }
      });
      const lessonString = this.extractJsonObject(this.textOf(response));
      return { result: lessonString, responseData: { parsedJson: lessonString } };
    }).catch(error => { throw this.serverError(error); });

    if (logContext?.content) {
      this.logger.log(`Successfully generated lesson for "${logContext.content}"`);
    }
    return lessonString;
  }

  async generateScenario(
    userMessage: string,
    toolDeclarations?: FunctionDeclaration[],
    toolHandlers?: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>>,
    responseSchema?: Record<string, unknown>,
  ): Promise<any> {
    if (toolDeclarations?.length && toolHandlers) {
      return this.generateWithTools<any>(
        userMessage,
        '',
        toolDeclarations,
        toolHandlers,
        responseSchema,
        { route: '/scenarios/generate', topic: userMessage.slice(0, 60) },
      );
    }

    return this.logged('/scenarios/generate', this.modelName, { userMessage }, async () => {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [{ parts: [{ text: userMessage }] }],
        config: {
          responseMimeType: "application/json",
          temperature: 0.4,
          ...(responseSchema ? { responseSchema: responseSchema as any } : {}),
        }
      });
      const scenarioString = this.extractJsonObject(this.textOf(response));
      return { result: this.parseJson<any>(scenarioString), responseData: { parsedJson: scenarioString } };
    }).catch(error => {
      this.logger.error('Gemini Service Error (Scenario):', error);
      throw new InternalServerErrorException("Failed to generate scenario");
    });
  }

  /**
   * Splits a Japanese sentence into word-level segments for SSML `<break>`
   * placement (pronunciation-practice "paced" mode). High-frequency,
   * per-click, low-value-to-persist — unlike other Gemini calls in this
   * service, deliberately skips apilogService logging.
   */
  async segmentJapaneseSentence(text: string): Promise<string[]> {
    const response = await this.client.models.generateContent({
      model: this.modelName,
      contents: [{ parts: [{ text: buildSegmentationPrompt(text) }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: SEGMENTATION_RESPONSE_SCHEMA as any,
      },
    });

    const parsed = this.parseJson<{ segments: string[] }>(this.textOf(response));
    return parsed.segments;
  }

  async generateQuestionAI(
    userMessage: string,
    systemPrompt: string,
    logContext?: Record<string, any>,
    fewShotTurns?: Array<{ user: string; model: string }>,
  ): Promise<string> {
    return this.logged('/questions/generate', this.modelName, { userMessage, systemPrompt }, async () => {
      const fewShotContents = (fewShotTurns ?? []).flatMap(({ user, model }) => [
        { role: 'user' as const, parts: [{ text: user }] },
        { role: 'model' as const, parts: [{ text: model }] },
      ]);

      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [...fewShotContents, { parts: [{ text: userMessage }] }],
        config: {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              question: { type: "STRING" },
              context: { type: "STRING" },
              answer: { type: "STRING" },
              accepted_alternatives: {
                type: "ARRAY",
                items: { type: "STRING" },
              },
            },
            required: ["question", "answer"],
          },
        },
      });

      // Returned unparsed: the caller parses and validates it.
      const text = this.textOf(response);
      return { result: text, responseData: { rawText: text } };
    }).catch(error => { throw this.serverError(error); });
  }

  async generateKanjiDetails(kanji: string) {
    const systemPrompt = buildKanjiDetailsSystemPrompt(kanji);
    const userMessage = buildKanjiDetailsUserMessage(kanji);

    const schema = {
      type: 'OBJECT',
      properties: {
        kanji: {
          type: 'OBJECT',
          properties: {
            meaning: { type: 'OBJECT', properties: { english: { type: 'STRING' } } },
            strokes: { type: 'OBJECT', properties: { count: { type: 'INTEGER' }, images: { type: 'ARRAY', items: { type: 'STRING' } } } },
            onyomi: { type: 'OBJECT', properties: { katakana: { type: 'STRING' } } },
            kunyomi: { type: 'OBJECT', properties: { hiragana: { type: 'STRING' } } },
          }
        },
        radical: {
          type: 'OBJECT',
          properties: {
            character: { type: 'STRING' },
            meaning: { type: 'OBJECT', properties: { english: { type: 'STRING' } } },
            image: { type: 'STRING' }
          }
        }
      },
      required: ['kanji', 'radical']
    };

    const requestData = { userMessage, systemPrompt, topic: kanji, source: 'kanji-fallback' };
    return this.logged('gemini-generate-kanji', this.modelName, requestData, async () => {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [{ parts: [{ text: userMessage }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          systemInstruction: { parts: [{ text: systemPrompt }] },
        },
      });
      const parsedJson = this.parseJson<any>(this.textOf(response));
      return { result: parsedJson, responseData: { rawText: response.text, parsedJson } };
    });
  }

  async createContextCache(
    content: string,
    ttlSeconds: number = 3600,
  ): Promise<string> {
    try {
      // @google/genai SDK format for cache creation
      // Note: The SDK might store caches under `client.caches`
      const cacheResponse = await this.client.caches.create({
        model: this.modelName,
        config: {
          systemInstruction: {
            parts: [{ text: content }],
          },
          ttl: `${ttlSeconds}s`,
        },
      });

      this.logger.log(`Created context cache: ${cacheResponse.name}`);
      if (!cacheResponse.name) {
        throw new Error("Context cache creation returned empty name");
      }
      return cacheResponse.name;
    } catch (error) {
      this.logger.error('Failed to create context cache', error);
      throw error;
    }
  }

  /**
   * Builds a Vocab lesson's usages from its examples and definitions (see buildUsageBuildMessage).
   * Returns the parsed JSON for the caller to check (checkBuiltUsages), or null if the call fails.
   */
  async buildExampleUsages(
    vocab: string,
    definitions: string[],
    examples: { sentence: string; translation: string }[],
    fixedLabels: (string | null)[],
    kuId: string,
    partOfSpeech?: string,
  ): Promise<unknown | null> {
    const userMessage = buildUsageBuildMessage(vocab, definitions, examples, fixedLabels, partOfSpeech);
    const schema = {
      type: 'OBJECT',
      properties: {
        usages: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              label: { type: 'STRING' },
              meaning: { type: 'STRING' },
              acceptedAnswers: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['label', 'meaning', 'acceptedAnswers'],
          },
        },
        exampleUsages: { type: 'ARRAY', items: { type: 'INTEGER' } },
        setAside: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['usages', 'exampleUsages', 'setAside'],
    };

    return this.logged('/lessons/build-usages', this.modelName, { userMessage, content: vocab, kuId }, async () => {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [{ parts: [{ text: userMessage }] }],
        config: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.2 },
      });
      const parsedJson = this.parseJson<unknown>(this.textOf(response));
      return { result: parsedJson, responseData: { rawText: response.text, parsedJson } };
    }).catch(error => {
      this.logger.error(`Failed to build usages for ${vocab}`, error);
      return null;
    });
  }

  /**
   * Furigana for a Grammar lesson's example sentences (lazy backfill). Returns one annotated
   * string per sentence (same order); the caller validates each against its original.
   */
  async addFurigana(sentences: string[], kuId: string): Promise<string[]> {
    const userMessage = buildFuriganaMessage(sentences);
    return this.logged('/lessons/furigana', this.modelName, { userMessage, kuId }, async () => {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [{ parts: [{ text: userMessage }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: { type: 'OBJECT', properties: { annotated: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['annotated'] } as any,
          temperature: 0.1,
        },
      });
      const parsedJson = this.parseJson<{ annotated: string[] }>(this.textOf(response));
      if (!Array.isArray(parsedJson.annotated) || parsedJson.annotated.length !== sentences.length) {
        throw new Error(`Expected ${sentences.length} annotated sentences, got ${parsedJson.annotated?.length}`);
      }
      return { result: parsedJson.annotated, responseData: { rawText: response.text, parsedJson } };
    });
  }

  // ─── Picture cards (audio-first vocab) ──────────────────────────────────────

  /** Runs a Gemini call wrapped in the standard api-logs start/complete bookkeeping. */
  private async logged<T>(
    route: string,
    model: string,
    requestData: ApiLog['requestData'],
    call: () => Promise<{ result: T; responseData: ApiLog['responseData'] }>,
  ): Promise<T> {
    // A failed log write mustn't fail (or be blamed on) the Gemini call: run it unlogged.
    const logRef = await this.apilogService
      .startLog({ timestamp: Timestamp.now(), route, status: 'pending', modelUsed: model, requestData })
      .catch(err => { this.logger.error(`Failed to start ${route} log`, err); return null; });
    const startTime = performance.now();
    const elapsed = () => Math.round(performance.now() - startTime);
    try {
      const { result, responseData } = await call();
      if (logRef) {
        this.apilogService
          .completeLog(logRef, { status: 'success', durationMs: elapsed(), responseData })
          .catch(err => console.error(`Failed to update ${route} log`, err));
      }
      return result;
    } catch (error: unknown) {
      if (logRef) {
        this.apilogService
          .completeLog(logRef, { status: 'error', durationMs: elapsed(), errorData: errorDataOf(error) })
          .catch(err => console.error(`Failed to update ${route} log`, err));
      }
      throw error;
    }
  }

  /** The response's text; when there's none, says why (finish reason or block reason) instead of failing blind. */
  private textOf(response: GenerateContentResponse | undefined): string {
    if (response?.text) return response.text;
    const finishReason = response?.candidates?.[0]?.finishReason;
    const blockReason = response?.promptFeedback?.blockReason;
    this.logger.error('Empty response text from Gemini', { finishReason, promptFeedback: response?.promptFeedback });
    throw new Error(`Empty response text from Gemini (${finishReason ?? blockReason ?? 'no reason given'})`);
  }

  /**
   * Parses a JSON object from Gemini. Bad JSON, or a `null`/non-object result, fails with a fixed
   * message (callers may send it to the client); the model's text goes to the backend log only.
   */
  private parseJson<T>(text: string): T {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.logger.error(`Failed to parse AI JSON response: ${text.slice(0, 200)}`);
      throw new Error('Failed to parse AI JSON response');
    }
    if (parsed === null || typeof parsed !== 'object') throw new Error('AI response was not a JSON object');
    return parsed as T;
  }

  /** Cuts a response down to its outermost {...} object, dropping any text the model wrote around it. */
  private extractJsonObject(text: string): string {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end < start) {
      this.logger.error(`AI response did not contain a valid JSON object: ${text.slice(0, 200)}`);
      throw new Error('AI response did not contain a valid JSON object.');
    }
    return text.substring(start, end + 1);
  }

  /** The 500 that evaluate, lesson and question callers get: the original message plus its details. */
  private serverError(error: unknown): InternalServerErrorException {
    this.logger.error('Gemini Service Error:', error);
    if (error instanceof Error) {
      const network = error.message.includes('fetch') || error.message.includes('network');
      return new InternalServerErrorException({
        error: network ? `Network error during API call: ${error.message}` : error.message,
        details: { message: error.message, name: error.name, stack: error.stack },
      });
    }
    const { rawError } = errorDataOf(error);
    return new InternalServerErrorException({ error: `Non-Error exception: ${rawError}`, details: { rawError } });
  }

  async generatePictureBrief(w: PictureBriefInput, kuId: string, route = '/pictures/brief'): Promise<PictureBrief> {
    return this.runPictureBrief(buildPictureBriefMessage(w), route, { content: w.word, kuId });
  }

  /** Step 1 for a free-standing picture: the editor's description is the subject. */
  async generateFreePictureBrief(description: string): Promise<PictureBrief> {
    return this.runPictureBrief(buildFreePictureBriefMessage(description), '/pictures/brief-free', { content: description.slice(0, 200) });
  }

  private async runPictureBrief(userMessage: string, route: string, meta: { content: string; kuId?: string }): Promise<PictureBrief> {
    return this.logged(route, this.modelName, { userMessage, content: meta.content, kuId: meta.kuId ?? null }, async () => {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [{ parts: [{ text: userMessage }] }],
        config: { responseMimeType: 'application/json', responseSchema: PICTURE_BRIEF_SCHEMA, temperature: 0.4 },
      });
      const parsedJson = this.parseJson<PictureBrief>(this.textOf(response));
      return { result: parsedJson, responseData: { rawText: response.text, parsedJson } };
    });
  }

  /**
   * Step 2: render the brief in the house style. `references` are the cast images,
   * attached only when the brief includes the cast. Retries transient 503s.
   */
  async generatePicture(
    brief: PictureBrief,
    references: { mimeType: string; data: string }[],
    kuId: string,
    style: PictureStyle = 'card',
  ): Promise<{ data: Buffer; mimeType: string }> {
    const prompt = buildPictureImagePrompt(brief, style);
    const parts: any[] = [{ text: prompt }];
    if (brief.includeCast) parts.push(...references.map(r => ({ inlineData: r })));

    // Image bytes are never logged (they'd blow the Firestore doc limit) — only metadata.
    return this.logged('/pictures/image', this.imageModelName, { userMessage: prompt, kuId, style }, async () => {
      const delays = [0, 3000, 8000];
      let lastError: any;
      for (const delay of delays) {
        if (delay) await new Promise(r => setTimeout(r, delay));
        try {
          const response = await this.client.models.generateContent({
            model: this.imageModelName,
            contents: [{ role: 'user', parts }],
            config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: PICTURE_STYLES[style].aspectRatio } },
          });
          const candidate = response.candidates?.[0];
          const image = candidate?.content?.parts?.find(p => p.inlineData?.data);
          if (!image?.inlineData?.data) {
            throw new Error(`No image returned (finishReason=${candidate?.finishReason ?? 'unknown'})`);
          }
          const buf = Buffer.from(image.inlineData.data, 'base64');
          const mimeType = image.inlineData.mimeType || 'image/png';
          return {
            result: { data: buf, mimeType },
            responseData: { parsedJson: { bytes: buf.length, mimeType, finishReason: candidate?.finishReason } },
          };
        } catch (error: any) {
          lastError = error;
          const transient = /\b(429|500|503|RESOURCE_EXHAUSTED|INTERNAL|UNAVAILABLE|Deadline expired)\b/.test(String(error?.message ?? error));
          if (!transient) throw error;
          this.logger.warn(`generatePicture: transient error for ${kuId}, retrying: ${error?.message}`);
        }
      }
      throw lastError;
    });
  }

  /** Step 3: does the image contain any writing? (binary, checkable — not a quality judge) */
  async checkPictureForText(image: Buffer, mimeType: string, kuId: string): Promise<{ hasText: boolean; where: string }> {
    return this.logged('/pictures/text-check', this.modelName, { userMessage: PICTURE_TEXT_CHECK_PROMPT, kuId }, async () => {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: image.toString('base64') } }, { text: PICTURE_TEXT_CHECK_PROMPT }] }],
        config: { responseMimeType: 'application/json', responseSchema: PICTURE_TEXT_CHECK_SCHEMA, temperature: 0 },
      });
      const parsedJson = this.parseJson<any>(this.textOf(response));
      return { result: parsedJson, responseData: { rawText: response.text, parsedJson } };
    });
  }

  /**
   * Generates a structured response via a tool-calling loop.
   *
   * Flow:
   *  1. Send the user message with the provided function declarations.
   *  2. While the model returns function calls: dispatch to handlers, feed responses back.
   *  3. Final turn: drop tools, enforce responseSchema, return parsed result.
   *
   * Tool handlers receive the function args and return a plain object that is
   * sent back to the model as the function response.
   */
  async generateWithTools<T>(
    userMessage: string,
    systemPrompt: string,
    toolDeclarations: FunctionDeclaration[],
    toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>>,
    responseSchema?: Record<string, unknown>,
    logContext?: Record<string, any>,
  ): Promise<T> {
    const route = logContext?.route ?? '/questions/generate';
    return this.logged(route, this.modelName, { userMessage, systemPrompt, ...logContext }, async () => {
      const toolCallLog: Array<{ fn: string; args: Record<string, unknown>; response: Record<string, unknown> }> = [];
      const contents: Content[] = [
        { role: 'user', parts: [{ text: userMessage }] },
      ];

      this.logger.log(`[generateWithTools] topic="${logContext?.topic ?? userMessage.slice(0, 40)}" tools=[${toolDeclarations.map(t => t.name).join(', ')}]`);

      // Tool-calling loop (safety cap: 5 iterations)
      for (let i = 0; i < 5; i++) {
        const response = await this.client.models.generateContent({
          model: this.modelName,
          contents,
          config: {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            tools: [{ functionDeclarations: toolDeclarations }],
            toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
          },
        });

        const calls = response.functionCalls;
        if (!calls || calls.length === 0) {
          this.logger.log(`[generateWithTools] No function calls on turn ${i + 1} — proceeding to final turn`);
          break;
        }

        this.logger.log(`[generateWithTools] Turn ${i + 1}: model called [${calls.map(c => c.name).join(', ')}]`);

        // Append model turn
        contents.push({ role: 'model', parts: response.candidates![0].content!.parts! });

        // Dispatch each call and collect responses
        const responseParts = await Promise.all(
          calls.map(async (fc) => {
            const handler = toolHandlers[fc.name!];
            const args = (fc.args as Record<string, unknown>) ?? {};
            const handlerResult = handler
              ? await handler(args)
              : { error: `Unknown function: ${fc.name}` };

            this.logger.log(`[generateWithTools] ${fc.name}() → ${JSON.stringify(handlerResult).slice(0, 200)}`);
            toolCallLog.push({ fn: fc.name!, args, response: handlerResult });

            return createPartFromFunctionResponse(fc.id ?? fc.name!, fc.name!, handlerResult);
          }),
        );

        contents.push({ role: 'user', parts: responseParts });
      }

      // Final turn: structured output, no tools
      const finalResponse = await this.client.models.generateContent({
        model: this.modelName,
        contents,
        config: {
          systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
          responseMimeType: 'application/json',
          ...(responseSchema ? { responseSchema: responseSchema as any } : {}),
        },
      });

      const result = this.parseJson<T>(this.textOf(finalResponse));
      this.logger.log(`[generateWithTools] result: ${JSON.stringify(result)}`);
      return { result, responseData: { toolCalls: toolCallLog, parsedJson: result } };
    }).catch(error => {
      this.logger.error('generateWithTools error:', error);
      throw new InternalServerErrorException('Failed to generate with tools');
    });
  }

  async deleteContextCache(name: string): Promise<void> {
    try {
      await this.client.caches.delete({ name });
      this.logger.log(`Deleted context cache: ${name}`);
    } catch (error) {
      // It's possible the cache expired or was already deleted
      this.logger.warn(`Failed to delete context cache ${name}`, error);
    }
  }

  async generateChatResponse(
    systemPrompt: string,
    userMessage: string,
    logContext?: Record<string, any>
  ) {
    const requestData = { userMessage, systemPrompt, input_topic: logContext?.topic, kuId: logContext?.scenarioId };
    return this.logged('/scenarios/chat', this.modelName, requestData, async () => {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [{ parts: [{ text: userMessage }] }],
        config: {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              message: { type: "STRING" },
              speaker: { type: "STRING" },
              correction: { type: "STRING", nullable: true },
              sceneFinished: { type: "BOOLEAN", nullable: true },
            },
            required: ["message", "speaker"],
          },
        },
      });
      const parsedJson = this.parseJson<{ message: string; speaker: string; correction?: string; sceneFinished?: boolean }>(this.textOf(response));
      return { result: parsedJson, responseData: { rawText: response.text, parsedJson } };
    }).catch(error => {
      this.logger.error('Gemini Service Chat Error:', error);
      throw new InternalServerErrorException("Failed to generate chat response");
    });
  }

  async evaluateScenario(
    chatHistory: { speaker: string; text: string }[],
    scenarioContext: { title: string; goal: string; difficulty: string; userRole?: string; aiRole?: string; isObjectiveMet: boolean }
  ): Promise<ScenarioEvaluation> {
    const requestData = {
      scenarioContext,
      historyLength: chatHistory.length,
      userMessage: "Scenario Evaluation", // Required by interface
    };
    return this.logged('/scenarios/evaluate', this.modelName, requestData, async () => {
      const prompt = buildScenarioEvaluatorPrompt(chatHistory, scenarioContext);

      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              success: { type: "BOOLEAN" },
              rating: { type: "INTEGER", description: "1-5 stars" },
              feedback: { type: "STRING" },
              corrections: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    original: { type: "STRING" },
                    correction: { type: "STRING" },
                    explanation: { type: "STRING" },
                  },
                },
              },
            },
            required: ["success", "rating", "feedback", "corrections"],
          },
        },
      });
      const parsedJson = this.parseJson<ScenarioEvaluation>(this.textOf(response));
      return { result: parsedJson, responseData: { parsedJson } };
    }).catch(error => {
      this.logger.error("Scenario Evaluation Failed", error);
      throw new InternalServerErrorException("Failed to evaluate scenario");
    });
  }

  async generateConcept(
    userMessage: string,
    logContext?: Record<string, any>,
  ): Promise<string> {
    this.logger.log(`Generating concept for topic: "${logContext?.topic ?? 'unknown'}"`);
    const requestData = { userMessage, topic: logContext?.topic };
    const conceptString = await this.logged('/concepts/generate', this.conceptModelName, requestData, async () => {
      const response = await this.client.models.generateContent({
        model: this.conceptModelName,
        contents: [{ parts: [{ text: userMessage }] }],
        config: {
          responseMimeType: "application/json",
          temperature: 0.5,
        },
      });
      const conceptString = this.extractJsonObject(this.textOf(response));
      return { result: conceptString, responseData: { rawText: conceptString.slice(0, 200) } };
    }).catch(error => {
      this.logger.error("Gemini generateConcept error:", error);
      throw new InternalServerErrorException("Failed to generate concept from AI.");
    });

    this.logger.log(`Successfully generated concept for "${logContext?.topic ?? 'unknown'}"`);
    return conceptString;
  }

  /** The models the admin Prompt Tester offers, named as the app configures them. */
  // Roles that share a model become one option, e.g. "flash / concept".
  promptTestModels(): Array<{ label: string; model: string; roles: string[] }> {
    const roles: Array<[string, string]> = [
      ['flash', this.modelName],
      ['pro', this.proModelName],
      ['concept', this.conceptModelName],
    ];
    const byModel = new Map<string, string[]>();
    for (const [role, model] of roles) byModel.set(model, [...(byModel.get(model) ?? []), role]);
    return [...byModel].map(([model, r]) => ({ label: r.join(' / '), model, roles: r }));
  }

  async runPromptTest(opts: {
    systemPrompt: string;
    userMessage: string;
    toolDeclarations: FunctionDeclaration[];
    toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>>;
    responseSchema?: Record<string, unknown>;
    model?: string;
    temperature?: number;
  }): Promise<{ rawText: string; parsedJson: any; toolCalls: Array<{ fn: string; args: any; response: any }>; durationMs: number }> {
    const { systemPrompt, userMessage, toolDeclarations, toolHandlers, responseSchema, model = this.modelName, temperature } = opts;
    // An empty system prompt is left out, as the app's own calls do (e.g. Concept generation).
    const systemInstruction = systemPrompt.trim() ? { parts: [{ text: systemPrompt }] } : undefined;
    const start = performance.now();
    const toolCallLog: Array<{ fn: string; args: any; response: any }> = [];

    const contents: Content[] = [
      { role: 'user', parts: [{ text: userMessage || '(no user message)' }] },
    ];

    // Tool-calling loop (cap 5)
    if (toolDeclarations.length > 0) {
      for (let i = 0; i < 5; i++) {
        const response = await this.client.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
            temperature,
            tools: [{ functionDeclarations: toolDeclarations }],
            toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
          },
        });

        const calls = response.functionCalls;
        if (!calls || calls.length === 0) break;

        contents.push({ role: 'model', parts: response.candidates![0].content!.parts! });

        const responseParts = await Promise.all(
          calls.map(async (fc) => {
            const handler = toolHandlers[fc.name!];
            const args = (fc.args as Record<string, unknown>) ?? {};
            const handlerResult = handler
              ? await handler(args)
              : { error: `Unknown function: ${fc.name}` };
            toolCallLog.push({ fn: fc.name!, args, response: handlerResult });
            return createPartFromFunctionResponse(fc.id ?? fc.name!, fc.name!, handlerResult);
          }),
        );

        contents.push({ role: 'user', parts: responseParts });
      }
    }

    // Final generation
    const finalConfig: any = { systemInstruction, temperature };
    if (responseSchema) {
      finalConfig.responseMimeType = 'application/json';
      finalConfig.responseSchema = responseSchema;
    }

    const finalResponse = await this.client.models.generateContent({
      model,
      contents,
      config: finalConfig,
    });

    const rawText = finalResponse.text ?? '';
    let parsedJson: any = null;
    if (responseSchema) {
      try { parsedJson = JSON.parse(rawText); } catch { /* leave null */ }
    }

    return {
      rawText,
      parsedJson,
      toolCalls: toolCallLog,
      durationMs: Math.round(performance.now() - start),
    };
  }
}
