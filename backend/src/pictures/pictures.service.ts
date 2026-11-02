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
  private readonly references: { mimeType: string; data: string }[];
  private job = { running: false, total: 0, done: 0, failed: 0, current: [] as string[] };

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly geminiService: GeminiService,
    configService: ConfigService,
  ) {
    this.dir = path.resolve(configService.get<string>('PICTURES_DIR') || 'data/pictures');
    fs.mkdirSync(this.dir, { recursive: true });
    const refDir = path.resolve('assets/picture-refs');
    this.references = ['fude.png', 'suzuri.png'].map(f => ({
      mimeType: 'image/png',
      data: fs.readFileSync(path.join(refDir, f)).toString('base64'),
    }));
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
    return { ...this.job };
  }

  /**
   * Starts background generation for the given KUs (or for `missingLimit` Vocab that
   * have a lesson but no pictures yet). Returns immediately; poll getJob()/list().
   */
  async startGeneration(opts: { kuIds?: string[]; missingLimit?: number; force?: boolean }) {
    if (this.job.running) throw new BadRequestException('A generation job is already running');
    let kuIds = opts.kuIds ?? [];
    if (!kuIds.length && opts.missingLimit) kuIds = await this.vocabWithoutPictures(opts.missingLimit);
    if (!kuIds.length) return this.getJob();

    this.job = { running: true, total: kuIds.length, done: 0, failed: 0, current: [] };
    const queue = [...kuIds];
    const worker = async () => {
      for (let kuId = queue.shift(); kuId; kuId = queue.shift()) {
        this.job.current.push(kuId);
        try {
          await this.generateForKu(kuId, !!opts.force);
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
        this.logger.log(`Picture job finished: ${this.job.done}/${this.job.total} (${this.job.failed} failed)`);
      });
    return this.getJob();
  }

  /** One picture per distinct example usage (up to 3). Skips KUs that already have pictures unless forced. */
  async generateForKu(kuId: string, force = false): Promise<Picture[]> {
    const existing = await this.col().where('kuId', '==', kuId).get();
    if (!force && !existing.empty) return [];
    const [kuDoc, lessonDoc] = await Promise.all([
      this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(kuId).get(),
      this.db.collection(LESSONS_COLLECTION).doc(kuId).get(),
    ]);
    if (!kuDoc.exists) throw new NotFoundException(`KU ${kuId} not found`);
    if (kuDoc.data()?.type !== 'Vocab') throw new BadRequestException(`KU ${kuId} is not Vocab`);
    if (!lessonDoc.exists) throw new BadRequestException(`KU ${kuId} has no lesson yet`);
    const lesson = lessonDoc.data() as VocabLesson;

    // Forced: replace this word's pictures (usages may have changed), don't add alongside them.
    if (force && !existing.empty) {
      for (const d of existing.docs) {
        const file = d.data().file as string | undefined;
        if (file) fs.rmSync(path.join(this.dir, file), { force: true });
        await d.ref.delete();
      }
    }

    const out: Picture[] = [];
    for (const source of this.usageSources(lesson)) {
      out.push(await this.generateOne(kuId, lesson, source));
    }
    return out;
  }

  /** Regenerate a picture for the same usage (new brief and image); replaces the doc's image. */
  async regenerate(id: string): Promise<Picture> {
    const pic = await this.get(id);
    const lessonDoc = await this.db.collection(LESSONS_COLLECTION).doc(pic.kuId).get();
    if (!lessonDoc.exists) throw new BadRequestException(`KU ${pic.kuId} has no lesson`);
    const fresh = await this.generateOne(pic.kuId, lessonDoc.data() as VocabLesson, pic.source, id);
    return fresh;
  }

  /** First example of each distinct usage (same rule as the Start Learning slides). */
  private usageSources(lesson: VocabLesson): PictureSource[] {
    const examples = lesson.context_examples ?? [];
    const definition = (lesson.definitions ?? [])[0] ?? lesson.definition ?? '';
    const strip = (s: string) => s.replace(/\[[^\]]*\]/g, '');
    if (!examples.length) return [{ usage: definition, definition, sentence: '', translation: '' }];
    if (!examples.some(e => e.usage)) {
      const e = examples[0];
      return [{ usage: definition, definition, sentence: strip(e.sentence), translation: e.translation }];
    }
    const seen = new Set<string>();
    const sources: PictureSource[] = [];
    for (const e of examples) {
      const key = (e.usage ?? '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      sources.push({ usage: e.usage!.trim(), definition, sentence: strip(e.sentence), translation: e.translation });
      if (sources.length >= MAX_USAGES) break;
    }
    return sources;
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
      return { id: ref.id, ...doc };
    }

    const attempts: Picture['attempts'] = [];
    let image: Buffer | null = null;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      image = await this.geminiService.generatePicture(brief, this.references, kuId);
      const check = await this.geminiService.checkPictureForText(image, kuId);
      attempts.push(check);
      if (!check.hasText) break;
    }
    // Unique name per generation, so a regenerate isn't masked by the image's long cache.
    const file = `${ref.id}-${Date.now()}.png`;
    fs.writeFileSync(path.join(this.dir, file), image!);
    if (existingId) this.removeOldFile(existingId, file);
    const status: PictureStatus = attempts[attempts.length - 1].hasText ? 'needs-review' : 'approved';
    const doc = { ...base, status, brief, file, attempts };
    await ref.set(doc);
    this.logger.log(`Picture ${ref.id} for ${lesson.vocab} (${source.usage}): ${status} after ${attempts.length} attempt(s)`);
    return { id: ref.id, ...doc };
  }

  private removeOldFile(id: string, keep: string) {
    for (const f of fs.readdirSync(this.dir)) {
      if (f.startsWith(`${id}-`) && f !== keep) fs.rmSync(path.join(this.dir, f), { force: true });
    }
  }

  /** Vocab KUs that have a lesson but no pictures (scans lessons; fine at hundreds of docs). */
  private async vocabWithoutPictures(limit: number): Promise<string[]> {
    const [lessons, pictures] = await Promise.all([
      this.db.collection(LESSONS_COLLECTION).where('type', '==', 'Vocab').get(),
      this.col().select('kuId').get(),
    ]);
    const have = new Set(pictures.docs.map(d => d.data().kuId as string));
    return lessons.docs.map(d => d.id).filter(id => !have.has(id)).slice(0, limit);
  }
}
