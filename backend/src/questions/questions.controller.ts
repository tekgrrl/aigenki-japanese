import { Controller, Get, Query, BadRequestException, Patch, Param, Body, UseGuards, Post, Delete } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { UserId } from '../auth/user-id.decorator';
import { AdminGuard } from '../auth/admin.guard';
import { QuestionsAdminService } from './questions-admin.service';

@Controller('questions')
@UseGuards(FirebaseAuthGuard)
export class QuestionsController {
  constructor(
    private readonly questionsService: QuestionsService,
    private readonly questionsAdmin: QuestionsAdminService,
  ) {}

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

  /** Admin Questions page: every question with its word, kind and how many cards show it. */
  @Get('admin')
  @UseGuards(AdminGuard)
  async adminList(
    @Query('kuType') kuType?: string,
    @Query('kuId') kuId?: string,
    @Query('kind') kind?: string,
    @Query('q') q?: string,
    @Query('hideReviewed') hideReviewed?: string,
  ) {
    return this.questionsAdmin.list({ kuType, kuId, kind, q, hideReviewed: hideReviewed === 'true' });
  }

  @Patch('admin/:id/reviewed')
  @UseGuards(AdminGuard)
  async adminSetReviewed(@Param('id') id: string, @Body() body: { reviewed: boolean }) {
    if (typeof body.reviewed !== 'boolean') throw new BadRequestException('reviewed must be true or false');
    await this.questionsAdmin.setReviewed(id, body.reviewed);
    return { success: true };
  }

  @Patch('admin/:id')
  @UseGuards(AdminGuard)
  async adminUpdate(
    @Param('id') id: string,
    @Body() body: { question?: string; context?: string; answer?: string; acceptedAlternatives?: string[] },
  ) {
    if (body.acceptedAlternatives !== undefined && !Array.isArray(body.acceptedAlternatives)) {
      throw new BadRequestException('acceptedAlternatives must be an array');
    }
    await this.questionsAdmin.update(id, body);
    return { success: true };
  }

  @Post('admin/:id/reassign')
  @UseGuards(AdminGuard)
  async adminReassign(@Param('id') id: string, @Body() body: { kuId: string }) {
    if (!body.kuId) throw new BadRequestException('kuId is required');
    await this.questionsAdmin.reassign(id, body.kuId);
    return { success: true };
  }

  @Delete('admin/:id')
  @UseGuards(AdminGuard)
  async adminRemove(@Param('id') id: string) {
    return this.questionsAdmin.remove(id);
  }
}
