import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { GeminiService } from '../gemini/gemini.service';
import type { PictureBrief, PictureStyle, PictureTextCheck } from '../types';

export const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

const MAX_ATTEMPTS = 3;

export type TextCheck = PictureTextCheck;

export interface RenderResult {
  /** Path relative to PICTURES_DIR (may include a subdirectory, e.g. "scenarios/uid/x.png"). */
  file: string;
  mimeType: string;
  attempts: TextCheck[];
  /** 'needs-review' when every attempt still had text (the last image is kept for review). */
  status: 'approved' | 'needs-review';
}

/**
 * The render step on its own: a brief in, a checked image file out. Knows nothing about
 * KUs, scenarios or Firestore, so any content type can use it. Image files live on local
 * disk under PICTURES_DIR.
 */
@Injectable()
export class PictureRenderer {
  private readonly logger = new Logger(PictureRenderer.name);
  readonly dir: string;
  private references: { mimeType: string; data: string }[] | null = null;

  constructor(
    private readonly geminiService: GeminiService,
    configService: ConfigService,
  ) {
    // Paths are resolved lazily on first use: a missing asset must never stop the backend booting.
    this.dir = path.resolve(configService.get<string>('PICTURES_DIR') || 'data/pictures');
  }

  /**
   * Render `brief` in `style`, retrying while the text check finds writing (up to 3
   * attempts). A later attempt failing keeps the earlier image. The file is named
   * `<prefix>-<timestamp>.<ext>` (unique per render, so a redraw isn't masked by the
   * image's long cache) inside `subdir` of PICTURES_DIR.
   */
  async render(
    brief: PictureBrief,
    opts: { style?: PictureStyle; prefix: string; subdir?: string; logId: string },
  ): Promise<RenderResult> {
    const style = opts.style ?? 'card';
    const references = brief.includeCast ? this.loadReferences() : [];
    const attempts: TextCheck[] = [];
    let image: { data: Buffer; mimeType: string } | null = null;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      try {
        const next = await this.geminiService.generatePicture(brief, references, opts.logId, style);
        const check = await this.geminiService.checkPictureForText(next.data, next.mimeType, opts.logId);
        image = next;
        attempts.push(check);
        if (!check.hasText) break;
      } catch (e) {
        // A later attempt failing shouldn't throw away an earlier image: keep it for review.
        if (!image) throw e;
        this.logger.warn(`Render attempt ${i + 1} for ${opts.logId} failed, keeping the earlier image: ${(e as Error).message}`);
        break;
      }
    }
    const ext = IMAGE_EXT[image!.mimeType] ?? 'png';
    const file = path.posix.join(opts.subdir ?? '', `${opts.prefix}-${Date.now()}.${ext}`);
    this.write(file, image!.data);
    const status = attempts[attempts.length - 1].hasText ? 'needs-review' : 'approved';
    return { file, mimeType: image!.mimeType, attempts, status };
  }

  /** Re-run the text check on an existing file. */
  async check(file: string, logId: string): Promise<TextCheck> {
    const p = this.resolve(file);
    if (!p || !fs.existsSync(p)) throw new Error(`Image file ${file} is missing`);
    const ext = path.extname(p).slice(1);
    const mimeType = Object.entries(IMAGE_EXT).find(([, e]) => e === ext)?.[0] ?? 'image/png';
    return this.geminiService.checkPictureForText(fs.readFileSync(p), mimeType, logId);
  }

  write(file: string, data: Buffer) {
    const p = this.resolve(file);
    if (!p) throw new Error(`Bad picture path ${file}`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  }

  /** Absolute path for a file name under PICTURES_DIR; null if it would escape it. */
  resolve(file: string): string | null {
    const p = path.resolve(this.dir, file);
    return p.startsWith(this.dir + path.sep) ? p : null;
  }

  remove(file: string) {
    const p = this.resolve(file);
    if (p) fs.rmSync(p, { force: true });
  }

  /** Remove files named `<prefix>-*` in `subdir`, except `keep`. */
  removeByPrefix(prefix: string, keep?: string, subdir = '') {
    const d = path.join(this.dir, subdir);
    if (!fs.existsSync(d)) return;
    const keepName = keep ? path.basename(keep) : undefined;
    for (const f of fs.readdirSync(d)) {
      if (f.startsWith(`${prefix}-`) && f !== keepName) fs.rmSync(path.join(d, f), { force: true });
    }
  }

  /** The cast reference images, loaded on first use (from backend/assets/picture-refs). */
  private loadReferences(): { mimeType: string; data: string }[] {
    if (this.references) return this.references;
    const candidates = [path.resolve('assets/picture-refs'), path.resolve(__dirname, '../../../assets/picture-refs'), path.resolve(__dirname, '../../assets/picture-refs')];
    const refDir = candidates.find(d => fs.existsSync(path.join(d, 'fude.png')));
    if (!refDir) throw new Error(`Picture reference images not found (looked in ${candidates.join(', ')})`);
    this.references = ['fude.png', 'suzuri.png'].map(f => ({
      mimeType: 'image/png',
      data: fs.readFileSync(path.join(refDir, f)).toString('base64'),
    }));
    return this.references;
  }
}
