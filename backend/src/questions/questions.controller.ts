import { Controller, Get, Query, BadRequestException, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { UserId } from '../auth/user-id.decorator';

@Controller('questions')
@UseGuards(FirebaseAuthGuard)
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get('generate')
  async generate(
    @UserId() uid: string,
    @Query('topic') topic: string,
    @Query('facetId') facetId: string,
    @Query('kuId') kuId: string,
    @Query('usageId') usageId?: string,
  ) {
    if (!topic) throw new BadRequestException('Topic is required');
    return this.questionsService.selectQuestion(uid, kuId, facetId, topic, usageId || undefined);
  }

  @Patch(':id/feedback')
  async recordFeedback(
    @UserId() uid: string,
    @Param('id') id: string,
    @Body() body: { feedback: 'keep' | 'request-new' | 'report' },
  ) {
    if (!body.feedback || !['keep', 'request-new', 'report'].includes(body.feedback)) {
      throw new BadRequestException('feedback must be keep, request-new, or report');
    }
    return this.questionsService.recordFeedback(uid, id, body.feedback);
  }
}
