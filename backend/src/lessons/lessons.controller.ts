import { Controller, Post, Body, BadRequestException, NotFoundException, Param, Put, Get, Query, Logger, UseGuards, HttpCode } from '@nestjs/common';
import { LessonsService } from './lessons.service';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UserId } from '../auth/user-id.decorator';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { buildGrammarLessonMessage } from '../prompts/grammar.prompts';
import { GrammarKnowledgeUnit } from '../types';
import { UserService } from '../users/user.service';

@Controller('lessons')
@UseGuards(FirebaseAuthGuard)
export class LessonsController {
  private readonly logger = new Logger(LessonsController.name);

  constructor(
    private readonly lessonsService: LessonsService,
    private readonly knowledgeUnitsService: KnowledgeUnitsService,
    private readonly userService: UserService,
  ) { }

  @Post('batch')
  async batch(@UserId() uid: string, @Body() body: { items: string[] }) {
    if (!body.items || !Array.isArray(body.items)) {
      throw new BadRequestException('items array is required');
    }

    const { items } = body;
    this.logger.log(`Received batch request for ${items.length} items`);

    // Fire and forget - background processing
    (async () => {
      try {
        const batchItems: { id: string; content: string }[] = [];

        // 1. Ensure KUs exist for all items
        for (const content of items) {
          try {
            const trimmed = content.trim();
            if (!trimmed) continue;

            const id = await this.knowledgeUnitsService.ensureVocab(trimmed);
            batchItems.push({ id, content: trimmed });
          } catch (e) {
            this.logger.error(`Failed to ensure KU for ${content}`, e);
          }
        }

        // 2. Process batch for lessons
        if (batchItems.length > 0) {
          await this.lessonsService.processBatch(uid, batchItems);
        }
      } catch (err) {
        this.logger.error('Background batch processing failed', err);
      }
    })();

    return { message: 'Batch processing started', count: items.length };
  }

  @Post('generate')
  async generate(@UserId() uid: string, @Body() body: { kuId: string }) {
    if (!body.kuId) {
      throw new BadRequestException('kuId is required');
    }
    return this.lessonsService.generateLesson(uid, body.kuId);
  }

  @Put(':kuId/global')
  @UseGuards(AdminGuard)
  async updateGlobal(
    @Param('kuId') kuId: string,
    @Body() body: { updates: Record<string, any> }
  ) {
    if (!body.updates || typeof body.updates !== 'object' || Array.isArray(body.updates)) {
      throw new BadRequestException('updates object is required');
    }

    return this.lessonsService.updateGlobalLesson(kuId, body.updates);
  }

  @Get()
  async findOne(@UserId() uid: string, @Query('kuId') kuId: string) {
    if (!kuId) {
      throw new BadRequestException('kuId is required');
    }

    const lesson = await this.lessonsService.findByKuId(kuId);

    // Return 404 if specific lesson lookup fails (optional, depends on frontend expectation)
    if (!lesson) {
      // We can return null or throw NotFoundException depending on need
      return null;
    }

    return lesson;
  }

  @Get('queue')
  async getQueue(@UserId() uid: string) {
    return this.lessonsService.getQueue(uid);
  }

  /** Lazy: build a Vocab lesson's usages (the Start Learning slideshow uses their labels). */
  @Post(':kuId/label-usages')
  async labelUsages(@Param('kuId') kuId: string) {
    if (!kuId) throw new BadRequestException('kuId is required');
    return this.lessonsService.buildVocabUsages(kuId);
  }

  /** Lazy furigana for a Grammar lesson's examples (used by the Start Learning slideshow). */
  @Post(':kuId/furigana')
  async addFurigana(@Param('kuId') kuId: string) {
    if (!kuId) throw new BadRequestException('kuId is required');
    return this.lessonsService.addGrammarFurigana(kuId);
  }

  /** Admin: rebuild a Vocab lesson's usages from scratch, even if already built. */
  @Post(':kuId/relabel-usages')
  @UseGuards(AdminGuard)
  async relabelUsages(@Param('kuId') kuId: string) {
    if (!kuId) throw new BadRequestException('kuId is required');
    return this.lessonsService.buildVocabUsages(kuId, true);
  }

  @Post('regenerate/:kuId')
  @UseGuards(AdminGuard)
  async regenerate(@UserId() uid: string, @Param('kuId') kuId: string) {
    if (!kuId) throw new BadRequestException('kuId is required');
    return this.lessonsService.regenerateLesson(uid, kuId);
  }

  @Get('grammar-lesson-prompt')
  @UseGuards(AdminGuard)
  async getGrammarLessonPrompt(@UserId() uid: string, @Query('kuId') kuId: string) {
    if (!kuId) throw new BadRequestException('kuId is required');
    const ku = await this.knowledgeUnitsService.findOneById(kuId);
    if (!ku || ku.type !== 'Grammar') throw new NotFoundException(`Grammar KU ${kuId} not found`);
    const userMessage = buildGrammarLessonMessage(ku as GrammarKnowledgeUnit, await this.userService.getJlptLevel(uid));
    return { kuId, content: ku.content, userMessage };
  }
}