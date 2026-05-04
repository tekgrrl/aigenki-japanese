import { Controller, Post, Body, BadRequestException, Param, Put, Get, Query, Logger, UseGuards } from '@nestjs/common';
import { LessonsService } from './lessons.service';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { UserId } from '../auth/user-id.decorator';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';

@Controller('lessons')
@UseGuards(FirebaseAuthGuard)
export class LessonsController {
  private readonly logger = new Logger(LessonsController.name);

  constructor(
    private readonly lessonsService: LessonsService,
    private readonly knowledgeUnitsService: KnowledgeUnitsService
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

  @Put(':kuId')
  async update(
    @UserId() uid: string,
    @Param('kuId') kuId: string,
    @Body() body: { section: string; content: string }
  ) {
    if (!body.section || body.content === undefined) {
      throw new BadRequestException('Section and content are required');
    }

    return this.lessonsService.updateLesson(uid, kuId, body.section, body.content);
  }

  @Get()
  async findOne(@UserId() uid: string, @Query('kuId') kuId: string) {
    if (!kuId) {
      throw new BadRequestException('kuId is required');
    }

    const lesson = await this.lessonsService.findByKuId(uid, kuId);

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

  @Get('user-grammar')
  async getUserGrammarLessons(@UserId() uid: string, @Query('kuId') kuId: string) {
    if (!kuId) {
      throw new BadRequestException('kuId is required');
    }
    return this.lessonsService.getUserGrammarLessons(uid, kuId);
  }
}