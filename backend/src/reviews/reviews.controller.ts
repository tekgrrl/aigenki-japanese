import { Controller, Post, Body, BadRequestException, Put, Param, Get, Query, Logger, UseGuards } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { ReviewProgressService } from '../review-progress/review-progress.service';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { UserId } from '../auth/user-id.decorator';
import { ALREADY_KNOWN_STAGE } from '../lib/constants';

@Controller('reviews')
@UseGuards(FirebaseAuthGuard)
export class ReviewsController {
  private readonly logger = new Logger(ReviewsController.name);

  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly reviewProgressService: ReviewProgressService,
  ) { }

  @Post('evaluate')
  async evaluate(@UserId() uid: string, @Body() body: { userAnswer: string; expectedAnswers: string[]; question: string; topic: string; questionId: string; kuId: string; facetType?: string; facetId?: string }) {
    const { userAnswer, expectedAnswers, question, topic, questionId, kuId, facetType, facetId } = body;

    this.logger.log(`body ${JSON.stringify(body)}`);

    if (
      userAnswer == null ||
      expectedAnswers == null ||
      !Array.isArray(expectedAnswers) ||
      expectedAnswers.length === 0
    ) {
      throw new BadRequestException('Missing userAnswer or expectedAnswer');
    }

    if (questionId && !kuId) {
      throw new BadRequestException('kuId is required when questionId is provided');
    }

    return this.reviewsService.evaluateAnswer(uid, userAnswer, expectedAnswers, question, topic, questionId, kuId, facetType as any, facetId);
  }

  @Put('facets/:id')
  async updateSrs(
    @UserId() uid: string,
    @Param('id') id: string,
    @Body() body: { result: 'pass' | 'fail' }
  ) {
    if (!body.result || (body.result !== 'pass' && body.result !== 'fail')) {
      throw new BadRequestException('Result must be "pass" or "fail"');
    }

    return this.reviewsService.updateFacetSrs(uid, id, body.result);
  }

  @Post('generate')
  async generateReviewFacets(
    @UserId() uid: string,
    @Body() body: { kuId: string; facetsToCreate: { key: string; data?: any }[]; selfCertifiedFacets?: string[] }
  ) {
    if (!body.kuId || !body.facetsToCreate || body.facetsToCreate.length === 0) {
      throw new BadRequestException('Missing kuId or facetsToCreate');
    }

    return this.reviewsService.generateReviewFacets(uid, body.kuId, body.facetsToCreate, body.selfCertifiedFacets ?? []);
  }

  @Post('initialize-sequence')
  async initializeSequence(
    @UserId() uid: string,
    @Body() body: { kuId: string; alreadyKnown?: boolean },
  ) {
    if (!body.kuId) throw new BadRequestException('Missing kuId');
    const startAtSrsStage = body.alreadyKnown ? ALREADY_KNOWN_STAGE : 0;
    return this.reviewProgressService.initializeSequence(uid, body.kuId, startAtSrsStage);
  }

  @Get('facets')
  async getFacets(
    @UserId() uid: string,
    @Query('due') due: string,
    @Query('kuId') kuId: string,
  ) {
    if (kuId) {
      return this.reviewsService.getFacetsByKuId(uid, kuId);
    }
    if (due === 'true') {
      return this.reviewsService.getDueReviews(uid);
    }
    return this.reviewsService.getAllFacets(uid);
  }
}
