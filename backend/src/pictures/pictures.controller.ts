import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Res, UseGuards, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { PicturesService, PictureStatus } from './pictures.service';

const STATUSES: PictureStatus[] = ['approved', 'needs-review', 'rejected', 'unpicturable'];

@Controller('pictures')
export class PicturesController {
  constructor(private readonly picturesService: PicturesService) {}

  /** Approved pictures for a KU (learner-facing). */
  @Get()
  @UseGuards(FirebaseAuthGuard)
  async forKu(@Query('kuId') kuId: string) {
    if (!kuId) throw new BadRequestException('kuId is required');
    return this.picturesService.list({ kuId, status: 'approved' });
  }

  /** All pictures with optional filters, plus the current generation job (admin review grid). */
  @Get('admin')
  @UseGuards(AdminGuard)
  async adminList(@Query('kuId') kuId?: string, @Query('status') status?: string, @Query('limit') limit?: string) {
    if (status && !STATUSES.includes(status as PictureStatus)) throw new BadRequestException(`Unknown status ${status}`);
    const pictures = await this.picturesService.list({
      kuId: kuId || undefined,
      status: (status as PictureStatus) || undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return { pictures, job: this.picturesService.getJob() };
  }

  /**
   * The image file. Unguarded on purpose: <img> requests can't carry the auth header,
   * and the images are generic illustrations, not user data.
   */
  @Get(':id/image')
  async image(@Param('id') id: string, @Res() res: Response) {
    const file = await this.picturesService.filePath(id);
    if (!file) throw new NotFoundException(`No image for picture ${id}`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(file);
  }

  /** Start background generation for explicit KU ids, or for N Vocab without pictures. */
  @Post('generate')
  @UseGuards(AdminGuard)
  async generate(@Body() body: { kuIds?: string[]; missingLimit?: number; force?: boolean }) {
    return this.picturesService.startGeneration(body ?? {});
  }

  @Post(':id/regenerate')
  @UseGuards(AdminGuard)
  async regenerate(@Param('id') id: string) {
    return this.picturesService.regenerate(id);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  async setStatus(@Param('id') id: string, @Body() body: { status: PictureStatus }) {
    if (!STATUSES.includes(body?.status)) throw new BadRequestException('Invalid status');
    return this.picturesService.setStatus(id, body.status);
  }
}
