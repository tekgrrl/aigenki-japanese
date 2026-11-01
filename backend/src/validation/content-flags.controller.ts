import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { ValidationService } from './validation.service';
import { UserId } from '../auth/user-id.decorator';

@Controller('content-flags')
@UseGuards(FirebaseAuthGuard, AdminGuard)
export class ContentFlagsController {
  constructor(private readonly validationService: ValidationService) {}

  @Get()
  async list(@Query('status') status?: string) {
    return this.validationService.getFlags(status ?? 'open');
  }

  @Post()
  async create(
    @UserId() uid: string,
    @Body() body: {
      sourceType: 'lesson' | 'scenario';
      sourceId: string;
      kuId?: string;
      kuContent?: string;
      userLevel?: string;
      manualNote?: string;
      quotedSegment?: string;
      category?: string;
    },
  ) {
    if (!body.sourceType || !body.sourceId) {
      throw new BadRequestException('sourceType and sourceId are required');
    }
    if (!body.kuContent && !body.kuId) {
      throw new BadRequestException('kuContent is required when kuId is not given');
    }
    if (!body.manualNote?.trim() && !body.category) {
      throw new BadRequestException('manualNote or category is required');
    }
    const id = await this.validationService.createManualFlag(uid, body);
    return { id };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { status: 'resolved' | 'dismissed'; dismissNote?: string },
  ) {
    if (!body.status || !['resolved', 'dismissed'].includes(body.status)) {
      throw new BadRequestException('status must be "resolved" or "dismissed"');
    }
    await this.validationService.updateFlag(id, body);
    return { success: true };
  }
}
