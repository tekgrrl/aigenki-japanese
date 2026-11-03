import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Res, UseGuards, BadRequestException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UserId } from '../auth/user-id.decorator';
import { MAX_UPLOAD_BYTES, PicturesService, PictureStatus, PictureSubject, PictureSubjectKind, SUBJECT_KINDS, UploadedImage } from './pictures.service';
import { isPictureStyle, PictureBrief, PictureStyle } from '../prompts/picture.prompts';

const STATUSES: PictureStatus[] = ['approved', 'needs-review', 'rejected', 'unpicturable'];

function parseKind(kind: unknown): PictureSubjectKind | undefined {
  if (kind === undefined || kind === '') return undefined;
  if (!SUBJECT_KINDS.includes(kind as PictureSubjectKind)) throw new BadRequestException(`Unknown subject kind ${kind}`);
  return kind as PictureSubjectKind;
}

function parseSubject(subject: unknown): PictureSubject {
  const s = subject as PictureSubject | undefined;
  const kind = parseKind(s?.kind);
  if (!kind) throw new BadRequestException('subject.kind is required');
  return { kind, kuId: s?.kuId || undefined, usage: s?.usage || undefined };
}

function parseStyle(style: unknown): PictureStyle | undefined {
  if (style === undefined || style === '') return undefined;
  if (!isPictureStyle(style)) throw new BadRequestException(`Unknown style ${style}`);
  return style;
}

@Controller('pictures')
export class PicturesController {
  constructor(private readonly picturesService: PicturesService) {}

  /** Approved pictures for a KU (learner-facing), optionally narrowed by subject kind / usage. */
  @Get()
  @UseGuards(FirebaseAuthGuard)
  async forKu(@Query('kuId') kuId: string, @Query('kind') kind?: string, @Query('usage') usage?: string) {
    if (!kuId) throw new BadRequestException('kuId is required');
    return this.picturesService.list({ kuId, status: 'approved', kind: parseKind(kind), usage: usage || undefined });
  }

  /** Distractor pictures for the four-picture choice card (other words, user's own first). */
  @Get('choices')
  @UseGuards(FirebaseAuthGuard)
  async choices(@UserId() uid: string, @Query('kuId') kuId: string, @Query('n') n?: string) {
    if (!kuId) throw new BadRequestException('kuId is required');
    return this.picturesService.choices(uid, kuId, Math.min(Math.max(Number(n) || 3, 1), 8));
  }

  /** All pictures with optional filters, plus the current generation job (admin review grid). */
  @Get('admin')
  @UseGuards(AdminGuard)
  async adminList(@Query('kuId') kuId?: string, @Query('status') status?: string, @Query('kind') kind?: string, @Query('limit') limit?: string) {
    if (status && !STATUSES.includes(status as PictureStatus)) throw new BadRequestException(`Unknown status ${status}`);
    const pictures = await this.picturesService.list({
      kuId: kuId || undefined,
      status: (status as PictureStatus) || undefined,
      kind: parseKind(kind),
      limit: limit ? Number(limit) : undefined,
    });
    return { pictures: await this.picturesService.annotateStale(pictures), job: this.picturesService.getJob() };
  }

  /**
   * The image file. Unguarded on purpose: <img> requests can't carry the auth header,
   * and the images are generic illustrations, not user data.
   */
  @Get(':id/image')
  async image(@Param('id') id: string, @Query('v') version: string | undefined, @Res() res: Response) {
    const file = await this.picturesService.filePath(id);
    if (!file) throw new NotFoundException(`No image for picture ${id}`);
    // Cache forever only when the URL names the current file (?v=<file>); a bare id URL
    // must revalidate, since a redraw changes the image behind the same id.
    const current = file.split(/[\\/]/).pop();
    res.setHeader('Cache-Control', version && version === current ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(file);
  }

  /** Draft a brief for a subject (one text call). Nothing is saved. */
  @Post('briefs')
  @UseGuards(AdminGuard)
  async draftBrief(@Body() body: { subject?: unknown; note?: string }) {
    return this.picturesService.draftBrief(parseSubject(body?.subject), body?.note);
  }

  /**
   * Make one new picture in the background: renders `brief` as given, or drafts one from
   * the subject (+ note). Returns the reserved id; it's in job.rendering until done.
   * No subject = a free-standing picture described by `note`.
   */
  @Post()
  @UseGuards(AdminGuard)
  async create(@Body() body: { subject?: unknown; brief?: PictureBrief; note?: string; style?: string }) {
    return this.picturesService.create({
      subject: body?.subject ? parseSubject(body.subject) : undefined,
      brief: body?.brief,
      note: body?.note,
      style: parseStyle(body?.style),
    });
  }

  /** Start background generation for explicit KU ids, or for N Vocab without pictures. */
  @Post('generate')
  @UseGuards(AdminGuard)
  async generate(@Body() body: { kuIds?: string[]; missingLimit?: number; force?: boolean }) {
    return this.picturesService.startGeneration(body ?? {});
  }

  /**
   * Attach a hand-made image (multipart: file, plus kind = ku-usage (default; kuId and an
   * optional usage) | ku (kuId) | none (an optional note describing it)).
   */
  @Post('upload')
  @UseGuards(AdminGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(@UploadedFile() file: UploadedImage | undefined, @Body() body: { kuId?: string; usage?: string; kind?: string; note?: string }) {
    if (!file) throw new BadRequestException('file is required');
    const kind = parseKind(body?.kind) ?? 'ku-usage';
    if (kind !== 'none' && !body?.kuId) throw new BadRequestException('kuId is required');
    return this.picturesService.upload(body?.kuId, body?.usage, file, kind, body?.note);
  }

  /** Redraw for the same subject: an edited `brief` renders as-is; otherwise a fresh brief, steered by `note`. */
  @Post(':id/redraw')
  @UseGuards(AdminGuard)
  async redraw(@Param('id') id: string, @Body() body: { brief?: PictureBrief; note?: string }) {
    return this.picturesService.redraw(id, { brief: body?.brief, note: body?.note });
  }

  /** @deprecated alias of POST :id/redraw with no brief or note. */
  @Post(':id/regenerate')
  @UseGuards(AdminGuard)
  async regenerate(@Param('id') id: string) {
    return this.picturesService.startRedraw(id);
  }

  /** Re-run the text check on the current image. */
  @Post(':id/check')
  @UseGuards(AdminGuard)
  async check(@Param('id') id: string) {
    return this.picturesService.check(id);
  }

  /** Any of: review status, (re)attach to a subject (kind 'none' detaches), an edited brief. */
  @Patch(':id')
  @UseGuards(AdminGuard)
  async update(@Param('id') id: string, @Body() body: { status?: PictureStatus; subject?: unknown; brief?: PictureBrief }) {
    if (body?.status === undefined && body?.subject === undefined && body?.brief === undefined) {
      throw new BadRequestException('Nothing to update: give status, subject or brief');
    }
    if (body.status !== undefined && !STATUSES.includes(body.status)) throw new BadRequestException('Invalid status');
    const subject = body.subject !== undefined ? parseSubject(body.subject) : undefined;
    if (subject) await this.picturesService.attach(id, subject);
    if (body.brief !== undefined) await this.picturesService.saveBrief(id, body.brief);
    if (body.status !== undefined) return this.picturesService.setStatus(id, body.status);
    return this.picturesService.get(id);
  }
}
