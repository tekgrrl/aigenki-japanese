import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';
import { FIRESTORE_CONNECTION, KNOWLEDGE_UNITS_COLLECTION, LESSONS_COLLECTION, PICTURES_COLLECTION } from '../firebase/firebase.module';
import { GeminiService } from '../gemini/gemini.service';
import { PictureBrief } from '../prompts/picture.prompts';
import { VocabLesson } from '../types';

export type PictureStatus = 'approved' | 'needs-review' | 'rejected' | 'unpicturable';

/** What a picture was generated from — kept so a regenerate uses the same usage. */
export interface PictureSource {
  usage: string;
  definition: string;
  sentence: string;
  translation: string;
}

export interface Picture {
  id: string;
  kuId: string;
  content: string;
  reading: string;
  usage: string;
  status: PictureStatus;
  source: PictureSource;
  brief?: PictureBrief;
  /** File name inside PICTURES_DIR; absent for unpicturable entries. */
  file?: string;
  attempts: { hasText: boolean; where: string }[];
  createdAt: Timestamp;
}

const MAX_USAGES = 3;
const MAX_ATTEMPTS = 3;
const CONCURRENCY = 2;

/**
 * Generates and stores text-free picture cards for Vocab (audio-first vocab, #246).
 * Image files live on local disk (PICTURES_DIR); metadata in the global `pictures`
 * collection. Global data — generation and status changes are admin-only.
 */
@Injectable()
export class PicturesService {
  private readonly logger = new Logger(PicturesService.name);
  private readonly dir: string;
  private references: { mimeType: string; data: string }[] | null = null;
  private job = { running: false, total: 0, done: 0, failed: 0, current: [] as string[] };
  /** Picture ids with a redraw in progress (redraws run in the background). */
  private readonly redrawing = new Set<string>();

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly geminiService: GeminiService,
    configService: ConfigService,
  ) {
    // Paths are resolved lazily on first use: a missing asset must never stop the backend booting.
    this.dir = path.resolve(configService.get<string>('PICTURES_DIR') || 'data/pictures');
  }

  /** The cast reference images, loaded on first generation (from backend/assets/picture-refs). */
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

  private ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private col() {
    return this.db.collection(PICTURES_COLLECTION);
  }

  async list(filter: { kuId?: string; status?: PictureStatus; limit?: number }): Promise<Picture[]> {
    let q: FirebaseFirestore.Query = this.col();
    if (filter.kuId) q = q.where('kuId', '==', filter.kuId);
    if (filter.status) q = q.where('status', '==', filter.status);
    const snap = await q.get();
    const pics = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Picture);
    pics.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    return filter.limit ? pics.slice(0, filter.limit) : pics;
  }

  async get(id: string): Promise<Picture> {
    const doc = await this.col().doc(id).get();
    if (!doc.exists) throw new NotFoundException(`Picture ${id} not found`);
    return { id: doc.id, ...doc.data() } as Picture;
  }

  /** Absolute path of a picture's image file, or null if it has none / it's missing on disk. */
  async filePath(id: string): Promise<string | null> {
    const pic = await this.get(id);
    if (!pic.file) return null;
    const p = path.join(this.dir, pic.file);
    return fs.existsSync(p) ? p : null;
  }

  async setStatus(id: string, status: PictureStatus): Promise<Picture> {
    await this.get(id);
    await this.col().doc(id).update({ status });
    return this.get(id);
  }

  getJob() {
    return { ...this.job, current: [...this.job.current], redrawing: [...this.redrawing] };
  }

  /**
   * Starts background generation for the given KUs (or for `missingLimit` Vocab whose
   * pictures don't yet cover every usage). Returns immediately; poll getJob()/list().
   */
  async startGeneration(opts: { kuIds?: string[]; missingLimit?: number; force?: boolean }) {
    if (this.job.running) throw new BadRequestException('A generation job is already running');
    // Claim the job slot before any await, so two quick requests can't both start one.
    this.job = { running: true, total: 0, done: 0, failed: 0, current: [] };
    let kuIds: string[];
    try {
      kuIds = [...new Set(opts.kuIds ?? [])];
      if (!kuIds.length && opts.missingLimit) kuIds = await this.vocabMissingPictures(opts.missingLimit);
    } catch (e) {
      this.job.running = false;
      throw e;
    }
    if (!kuIds.length) {
      this.job.running = false;
      return this.getJob();
    }

    this.job.total = kuIds.length;
    const queue = [...kuIds];
    const worker = async () => {
      for (let kuId = queue.shift(); kuId; kuId = queue.shift()) {
        this.job.current.push(kuId);
        try {
          const { failed } = await this.generateForKu(kuId, !!opts.force);
          if (failed > 0) this.job.failed++;
        } catch (e: any) {
          this.job.failed++;
          this.logger.error(`Picture generation failed for ${kuId}: ${e?.message}`);
        } finally {
          this.job.done++;
          this.job.current = this.job.current.filter(k => k !== kuId);
        }
      }
    };
    Promise.all(Array.from({ length: CONCURRENCY }, worker))
      .catch(e => this.logger.error('Picture job crashed', e))
      .finally(() => {
        this.job.running = false;
        this.logger.log(`Picture job finished: ${this.job.done}/${this.job.total} (${this.job.failed} with failures)`);
      });
    return this.getJob();
  }

  /**
   * One picture per distinct example usage (up to 3).
   * - Normal: only usages that don't have a picture yet (so a partial word gets completed).
   * - Forced: rebuild every usage; old pictures are removed only once their replacement
   *   exists (or their usage no longer exists), so a failure never loses approved images.
   * One usage failing doesn't stop the others.
   */
  async generateForKu(kuId: string, force = false): Promise<{ pictures: Picture[]; failed: number }> {
    const [kuDoc, lessonDoc, existing] = await Promise.all([
      this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(kuId).get(),
      this.db.collection(LESSONS_COLLECTION).doc(kuId).get(),
      this.col().where('kuId', '==', kuId).get(),
    ]);
    if (!kuDoc.exists) throw new NotFoundException(`KU ${kuId} not found`);
    if (kuDoc.data()?.type !== 'Vocab') throw new BadRequestException(`KU ${kuId} is not Vocab`);
    if (!lessonDoc.exists) throw new BadRequestException(`KU ${kuId} has no lesson yet`);
    const lesson = lessonDoc.data() as VocabLesson;

    const key = (u: string) => u.trim().toLowerCase();
    const sources = usageSources(lesson);
    const have = new Set(existing.docs.map(d => key(d.data().usage ?? '')));
    const todo = force ? sources : sources.filter(s => !have.has(key(s.usage)));

    const pictures: Picture[] = [];
    let failed = 0;
    for (const source of todo) {
      try {
        pictures.push(await this.generateOne(kuId, lesson, source));
      } catch (e: any) {
        failed++;
        this.logger.error(`Picture for ${lesson.vocab} (${source.usage}) failed: ${e?.message}`);
      }
    }

    if (force && pictures.length > 0) {
      const replaced = new Set(pictures.map(p => key(p.usage)));
      const current = new Set(sources.map(s => key(s.usage)));
      for (const d of existing.docs) {
        const u = key(d.data().usage ?? '');
        if (replaced.has(u) || !current.has(u)) await this.deletePicture(d.id, d.data().file);
      }
    }
    return { pictures, failed };
  }

  /**
   * Redraw a picture for the same usage, in the background (a full redraw can outlast the
   * /api proxy's timeout). Poll the admin list; the id is in `job.redrawing` until done.
   */
  async startRedraw(id: string): Promise<{ id: string; redrawing: true }> {
    if (this.redrawing.has(id)) throw new BadRequestException('This picture is already being redrawn');
    const pic = await this.get(id);
    const lessonDoc = await this.db.collection(LESSONS_COLLECTION).doc(pic.kuId).get();
    if (!lessonDoc.exists) throw new BadRequestException(`KU ${pic.kuId} has no lesson`);
    this.redrawing.add(id);
    this.generateOne(pic.kuId, lessonDoc.data() as VocabLesson, pic.source, id)
      .catch(e => this.logger.error(`Redraw of picture ${id} failed: ${e?.message}`))
      .finally(() => this.redrawing.delete(id));
    return { id, redrawing: true };
  }

  private async generateOne(kuId: string, lesson: VocabLesson, source: PictureSource, existingId?: string): Promise<Picture> {
    const ref = existingId ? this.col().doc(existingId) : this.col().doc();
    const base = {
      kuId,
      content: lesson.vocab,
      reading: lesson.reading,
      usage: source.usage,
      source,
      createdAt: Timestamp.now(),
    };

    const brief = await this.geminiService.generatePictureBrief(
      { word: lesson.vocab, reading: lesson.reading, ...source },
      kuId,
    );
    if (!brief.picturable) {
      const doc = { ...base, status: 'unpicturable' as const, brief, attempts: [] };
      await ref.set(doc);
      if (existingId) this.removeOldFiles(existingId); // a redraw that's now unpicturable keeps no image
      return { id: ref.id, ...doc };
    }

    const references = this.loadReferences();
    const attempts: Picture['attempts'] = [];
    let image: { data: Buffer; mimeType: string } | null = null;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      image = await this.geminiService.generatePicture(brief, references, kuId);
      const check = await this.geminiService.checkPictureForText(image.data, image.mimeType, kuId);
      attempts.push(check);
      if (!check.hasText) break;
    }
    // Unique name per generation, so a redraw isn't masked by the image's long cache.
    this.ensureDir();
    const ext = image!.mimeType === 'image/jpeg' ? 'jpg' : image!.mimeType === 'image/webp' ? 'webp' : 'png';
    const file = `${ref.id}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(this.dir, file), image!.data);
    const status: PictureStatus = attempts[attempts.length - 1].hasText ? 'needs-review' : 'approved';
    const doc = { ...base, status, brief, file, attempts };
    await ref.set(doc);
    if (existingId) this.removeOldFiles(existingId, file);
    this.logger.log(`Picture ${ref.id} for ${lesson.vocab} (${source.usage}): ${status} after ${attempts.length} attempt(s)`);
    return { id: ref.id, ...doc };
  }

  private async deletePicture(id: string, file?: string) {
    if (file) fs.rmSync(path.join(this.dir, file), { force: true });
    await this.col().doc(id).delete();
  }

  /** Remove a picture's image files, except `keep`. */
  private removeOldFiles(id: string, keep?: string) {
    if (!fs.existsSync(this.dir)) return;
    for (const f of fs.readdirSync(this.dir)) {
      if (f.startsWith(`${id}-`) && f !== keep) fs.rmSync(path.join(this.dir, f), { force: true });
    }
  }

  /** Vocab KUs with a lesson whose pictures don't cover every usage yet (scans lessons; fine at hundreds). */
  private async vocabMissingPictures(limit: number): Promise<string[]> {
    const [lessons, pictures] = await Promise.all([
      this.db.collection(LESSONS_COLLECTION).where('type', '==', 'Vocab').get(),
      this.col().select('kuId').get(),
    ]);
    const count = new Map<string, number>();
    for (const d of pictures.docs) count.set(d.data().kuId, (count.get(d.data().kuId) ?? 0) + 1);
    return lessons.docs
      .filter(d => (count.get(d.id) ?? 0) < usageSources(d.data() as VocabLesson).length)
      .map(d => d.id)
      .slice(0, limit);
  }
}

/**
 * Which usages get a picture — the same rule as the Start Learning slides
 * (frontend LessonSlides.vocabExampleSlides): the first example of each distinct
 * usage when every example is labelled, otherwise just the first example. Capped at 3.
 */
export function usageSources(lesson: VocabLesson): PictureSource[] {
  const examples = lesson.context_examples ?? [];
  const definition = (lesson.definitions ?? [])[0] ?? lesson.definition ?? '';
  const strip = (s: string) => s.replace(/\[[^\]]*\]/g, '');
  if (!examples.length) return [{ usage: definition, definition, sentence: '', translation: '' }];
  if (!examples.every(e => e.usage)) {
    const e = examples[0];
    return [{ usage: definition, definition, sentence: strip(e.sentence), translation: e.translation }];
  }
  const seen = new Set<string>();
  const sources: PictureSource[] = [];
  for (const e of examples) {
    const key = e.usage!.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ usage: e.usage!.trim(), definition, sentence: strip(e.sentence), translation: e.translation });
    if (sources.length >= MAX_USAGES) break;
  }
  return sources;
}
