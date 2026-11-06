import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';
import { CONCEPTS_COLLECTION, FIRESTORE_CONNECTION, KNOWLEDGE_UNITS_COLLECTION, LESSONS_COLLECTION, PICTURES_COLLECTION, USER_KUS_SUBCOLLECTION } from '../firebase/firebase.module';
import { GeminiService } from '../gemini/gemini.service';
import { PictureBriefInput } from '../prompts/picture.prompts';
import {
  AdminPicture,
  Picture,
  PictureBrief,
  PictureSource,
  PictureStatus,
  PictureStyle,
  PictureSubject,
  PictureSubjectKind,
  SUBJECT_KINDS,
  UsageState,
  UsageStates,
  VocabLesson,
} from '../types';
import { IMAGE_EXT, PictureRenderer, TextCheck } from './picture-renderer';

// The picture types live in src/types; re-exported for this module's existing importers.
export type { AdminPicture, Picture, PictureSource, PictureStatus, PictureSubject, PictureSubjectKind };
export { SUBJECT_KINDS };

/** A file accepted by upload (the subset of multer's file object we use). */
export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/** The single rule for matching usage labels (case- and whitespace-insensitive). */
export const usageKey = (u: string | undefined | null) => (u ?? '').trim().toLowerCase();

/** A picture's subject; docs from before subjects existed are Vocab usage pictures. */
export function subjectOf(p: { subject?: PictureSubject; kuId?: string | null; usage?: string }): PictureSubject {
  return p.subject ?? { kind: 'ku-usage', kuId: p.kuId ?? undefined, usage: p.usage };
}
/** Only usage pictures are learner cards: whole-KU and free-standing ones never show as choices. */
export const isUsagePicture = (data: Record<string, any>) => subjectOf(data).kind === 'ku-usage';

/** Everything needed to brief and store a picture for a subject. */
interface SubjectContext {
  subject: PictureSubject;
  kuId: string | null;
  content: string;
  reading: string;
  usage: string;
  source: PictureSource;
  /** Brief input; null for 'none' (briefed from the editor's description). */
  briefInput: PictureBriefInput | null;
  briefRoute: string;
}

/** Does the buffer really hold a PNG / JPEG / WebP? (The client's mimetype is only a claim.) */
function sniffImage(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

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
  private job = { running: false, total: 0, done: 0, failed: 0, current: [] as string[] };
  /** Picture ids with a redraw in progress (redraws run in the background). */
  private readonly redrawing = new Set<string>();
  /** New pictures being rendered in the background. Their doc appears when done. */
  private readonly rendering = new Map<string, { label: string; kuId: string | null; usage: string }>();

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly geminiService: GeminiService,
    configService: ConfigService,
    private readonly renderer: PictureRenderer,
  ) {
    this.dir = renderer.dir;
  }

  private ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private col() {
    return this.db.collection(PICTURES_COLLECTION);
  }

  async list(filter: { kuId?: string; status?: PictureStatus; kind?: PictureSubjectKind; usage?: string; limit?: number }): Promise<Picture[]> {
    let q: FirebaseFirestore.Query = this.col();
    if (filter.kuId) q = q.where('kuId', '==', filter.kuId);
    if (filter.status) q = q.where('status', '==', filter.status);
    const snap = await q.get();
    // Subject filters run in memory: older docs have no `subject` field to query on.
    const pics = snap.docs
      .map(d => ({ id: d.id, ...d.data() }) as Picture)
      .filter(p => !filter.kind || subjectOf(p).kind === filter.kind)
      .filter(p => filter.usage === undefined || usageKey(subjectOf(p).usage) === usageKey(filter.usage));
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
    const p = this.renderer.resolve(pic.file);
    return p && fs.existsSync(p) ? p : null;
  }

  async setStatus(id: string, status: PictureStatus): Promise<Picture> {
    // Only the brief step decides a picture can't be drawn; the admin redraws or rejects.
    if (status === 'unpicturable') throw new BadRequestException('Only the AI marks a picture unpicturable: redraw or reject it instead');
    const pic = await this.get(id);
    if (status === 'approved' && !pic.file) throw new BadRequestException('A picture without an image cannot be approved');
    await this.col().doc(id).update({ status });
    return this.get(id);
  }

  /**
   * Where each of a Vocab word's usages stands, for the Add a Picture flow:
   * bound (an approved picture), waiting (one in Needs Review or Unpicturable, or being
   * drawn now) or none. Rejected pictures don't count, but are reported.
   */
  async usageStates(kuId: string): Promise<UsageStates> {
    const [kuDoc, lessonDoc, existing] = await Promise.all([
      this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(kuId).get(),
      this.db.collection(LESSONS_COLLECTION).doc(kuId).get(),
      this.col().where('kuId', '==', kuId).get(),
    ]);
    if (!kuDoc.exists) throw new NotFoundException(`KU ${kuId} not found`);
    if (kuDoc.data()?.type !== 'Vocab') throw new BadRequestException(`KU ${kuId} is not Vocab`);
    if (!lessonDoc.exists) throw new BadRequestException(`KU ${kuId} has no lesson yet`);
    const lesson = lessonDoc.data() as VocabLesson;
    const pics = existing.docs.filter(d => isUsagePicture(d.data()));
    const drawing = [...this.rendering.values()].filter(r => r.kuId === kuId);
    return {
      kuId,
      content: lesson.vocab,
      reading: lesson.reading,
      labelled: usagesLabelled(lesson),
      usages: usageSources(lesson).map(s => {
        const mine = pics.filter(d => usageKey(d.data().usage) === usageKey(s.usage));
        const by = (st: PictureStatus) => mine.filter(d => d.data().status === st).map(d => d.id);
        const bound = by('approved');
        const waiting = [...by('needs-review'), ...by('unpicturable')];
        const isDrawing = drawing.some(r => usageKey(r.usage) === usageKey(s.usage));
        const state: UsageState = bound.length ? 'bound' : waiting.length || isDrawing ? 'waiting' : 'none';
        return {
          usage: s.usage,
          sentence: s.sentence,
          translation: s.translation,
          state,
          pictureIds: [...bound, ...waiting],
          pictures: [...bound, ...waiting].map(id => {
            const d = mine.find(x => x.id === id)!.data();
            return { id, status: d.status as PictureStatus, ...(d.file ? { file: d.file as string } : {}) };
          }),
          drawing: isDrawing,
          rejected: by('rejected').length,
        };
      }),
    };
  }

  getJob() {
    return {
      ...this.job,
      current: [...this.job.current],
      redrawing: [...this.redrawing],
      rendering: [...this.rendering].map(([id, r]) => ({ id, label: r.label })),
    };
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
   * One picture per distinct example usage.
   * - Normal: only usages that don't have a picture yet (so a partial word gets completed).
   * - Forced: rebuild every usage; an old picture is removed only once an approved
   *   replacement exists, so a failure or worse result never loses an approved image.
   * Pictures for usages that no longer exist are removed in both modes.
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

    const key = usageKey;
    const sources = usageSources(lesson);
    // Only usage pictures take part: a whole-KU picture or diagram isn't a usage's card.
    const usageDocs = existing.docs.filter(d => isUsagePicture(d.data()));
    const have = new Set(usageDocs.map(d => key(d.data().usage ?? '')));
    // An uploaded picture is the authority for its usage: never generate over it, even
    // forced. A REJECTED upload isn't — its usage can be generated again.
    const uploaded = new Set(
      usageDocs
        .filter(d => d.data().origin === 'uploaded' && d.data().status !== 'rejected')
        .map(d => key(d.data().usage ?? '')),
    );
    const todo = (force ? sources : sources.filter(s => !have.has(key(s.usage)))).filter(s => !uploaded.has(key(s.usage)));

    const pictures: Picture[] = [];
    let failed = 0;
    for (const source of todo) {
      try {
        // Generation is slow; an upload may have arrived for this usage since we started.
        if (await this.hasActiveUpload(kuId, source.usage)) continue;
        pictures.push(await this.produce(this.col().doc(), this.usageContext(kuId, lesson, source)));
      } catch (e: any) {
        failed++;
        this.logger.error(`Picture for ${lesson.vocab} (${source.usage}) failed: ${e?.message}`);
      }
    }

    // Clean up old pictures (both modes):
    // - stale: its usage no longer exists (e.g. after a relabel) and the word now has at
    //   least one picture for a current usage;
    // - replaced (forced only): its usage got a new APPROVED picture. A worse replacement
    //   (needs-review / unpicturable) never removes an approved image.
    // Pictures mid-redraw, and uploaded pictures, are left alone.
    const current = new Set(sources.map(s => key(s.usage)));
    const approvedNew = new Set(pictures.filter(p => p.status === 'approved').map(p => key(p.usage)));
    const coversCurrent =
      pictures.some(p => p.file) || usageDocs.some(d => d.data().file && current.has(key(d.data().usage ?? '')));
    for (const d of usageDocs) {
      if (this.redrawing.has(d.id) || d.data().origin === 'uploaded') continue; // never auto-delete uploads
      const u = key(d.data().usage ?? '');
      const stale = !current.has(u) && coversCurrent;
      const replaced = force && approvedNew.has(u);
      if (stale || replaced) await this.deletePicture(d.id, d.data().file);
    }
    return { pictures, failed };
  }

  /** Redraw with a fresh brief for the same subject (kept for the existing callers). */
  async startRedraw(id: string): Promise<{ id: string; redrawing: true }> {
    return this.redraw(id, {});
  }

  /**
   * Redraw a picture for the same subject, in the background (a full redraw can outlast
   * the /api proxy's timeout). `brief` renders an edited brief as-is (no brief call);
   * otherwise a fresh brief is drafted, steered by `note` if given. Poll the admin list;
   * the id is in `job.redrawing` until done.
   */
  async redraw(id: string, opts: { brief?: PictureBrief; note?: string }): Promise<{ id: string; redrawing: true }> {
    if (this.redrawing.has(id)) throw new BadRequestException('This picture is already being redrawn');
    this.redrawing.add(id); // claim before any await, so a double click can't start two
    let pic: Picture;
    let ctx: SubjectContext;
    try {
      if (opts.brief) assertBrief(opts.brief);
      pic = await this.get(id);
      if (pic.origin === 'uploaded') throw new BadRequestException('Uploaded pictures can\'t be redrawn: upload a new one instead');
      ctx = await this.redrawContext(pic, opts.note);
    } catch (e) {
      this.redrawing.delete(id);
      throw e;
    }
    this.produce(this.col().doc(id), ctx, { brief: opts.brief, note: opts.note ?? pic.note, style: pic.style }, id) // a plain redraw keeps the saved note
      .catch(e => this.logger.error(`Redraw of picture ${id} failed: ${e?.message}`))
      .finally(() => this.redrawing.delete(id));
    return { id, redrawing: true };
  }

  /** The context a redraw uses: a usage picture keeps its stored source (the usage it was made for). */
  private async redrawContext(pic: Picture, note?: string): Promise<SubjectContext> {
    const subject = subjectOf(pic);
    if (subject.kind === 'ku-usage') {
      const lessonDoc = await this.db.collection(LESSONS_COLLECTION).doc(pic.kuId!).get();
      if (!lessonDoc.exists) throw new BadRequestException(`KU ${pic.kuId} has no lesson`);
      return this.usageContext(pic.kuId!, lessonDoc.data() as VocabLesson, pic.source);
    }
    if (subject.kind === 'none') {
      const description = note?.trim() || pic.note || pic.source?.definition;
      if (!description) throw new BadRequestException('A free-standing picture needs a note describing it');
      return this.freeContext(description);
    }
    return this.resolveSubject(subject);
  }

  /**
   * Draft a brief for a subject without saving anything (one text call). `note` steers
   * it; for a free-standing ('none') subject the note IS the description.
   */
  async draftBrief(subject: PictureSubject, note?: string): Promise<PictureBrief> {
    const ctx = subject.kind === 'none' ? this.freeContext(note ?? '') : await this.resolveSubject(subject);
    return this.brief(ctx, note);
  }

  /**
   * Make a new picture in the background and return its id straight away. Renders
   * `brief` as given, or drafts one from the subject (+ note). The doc is written only
   * when the render finishes, so a restart can't leave a half-made picture behind; until
   * then the id is listed in `job.rendering`.
   */
  async create(input: { subject?: PictureSubject; brief?: PictureBrief; note?: string; style?: PictureStyle }): Promise<{ id: string; rendering: true }> {
    const subject = input.subject ?? { kind: 'none' };
    if (input.brief) assertBrief(input.brief);
    const ctx =
      subject.kind === 'none'
        ? this.freeContext(input.note?.trim() || input.brief?.scene || '')
        : await this.resolveSubject(subject);
    const ref = this.col().doc();
    this.rendering.set(ref.id, { label: ctx.usage ? `${ctx.content} (${ctx.usage})` : ctx.content, kuId: ctx.kuId, usage: ctx.usage });
    this.produce(ref, ctx, { brief: input.brief, note: input.note, style: input.style })
      .catch(e => this.logger.error(`Picture ${ref.id} for ${ctx.content} failed: ${e?.message}`))
      .finally(() => this.rendering.delete(ref.id));
    return { id: ref.id, rendering: true };
  }

  /** Re-run the text check on a picture's current image; the result is added to its attempts. */
  async check(id: string): Promise<TextCheck> {
    const pic = await this.get(id);
    if (!pic.file) throw new BadRequestException('This picture has no image');
    const result = await this.renderer.check(pic.file, pic.kuId ?? id);
    await this.col().doc(id).update({ attempts: [...(pic.attempts ?? []), result] });
    return result;
  }

  /**
   * Attach a picture to a subject, move it to another, or detach it ('none'). The picture
   * keeps its image and status; only what it's OF changes.
   */
  async attach(id: string, subject: PictureSubject): Promise<Picture> {
    const pic = await this.get(id);
    const ctx = subject.kind === 'none' ? this.freeContext(pic.note || pic.source?.definition || [pic.content, pic.usage].filter(Boolean).join(': ') || 'Detached picture') : await this.resolveSubject(subject);
    await this.col().doc(id).update({
      subject: ctx.subject,
      kuId: ctx.kuId,
      content: ctx.content,
      reading: ctx.reading,
      usage: ctx.usage,
      source: ctx.source,
    });
    return this.get(id);
  }

  /** Save an edited brief (used by the next redraw with `brief`, or just kept for reference). */
  async saveBrief(id: string, brief: PictureBrief): Promise<Picture> {
    assertBrief(brief);
    await this.get(id);
    await this.col().doc(id).update({ brief });
    return this.get(id);
  }

  /** Brief → render → save. Shared by batch generation, create and redraw. */
  private async produce(
    ref: FirebaseFirestore.DocumentReference,
    ctx: SubjectContext,
    opts: { brief?: PictureBrief; note?: string; style?: PictureStyle } = {},
    existingId?: string,
  ): Promise<Picture> {
    const style = opts.style ?? 'card';
    const base = {
      kuId: ctx.kuId,
      subject: ctx.subject,
      content: ctx.content,
      reading: ctx.reading,
      usage: ctx.usage,
      source: ctx.source,
      ...(style !== 'card' ? { style } : {}),
      ...(opts.note?.trim() ? { note: opts.note.trim() } : {}),
      createdAt: Timestamp.now(),
    };

    const brief = opts.brief ?? (await this.brief(ctx, opts.note));
    if (!brief.picturable) {
      const doc = { ...base, status: 'unpicturable' as const, brief, attempts: [] };
      await ref.set(doc);
      if (existingId) this.renderer.removeByPrefix(existingId); // a redraw that's now unpicturable keeps no image
      return { id: ref.id, ...doc };
    }

    const result = await this.renderer.render(brief, { style, prefix: ref.id, logId: ctx.kuId ?? ref.id });
    // Every new Image waits for the admin: nothing reaches learners until it's approved.
    // (The text check's verdict stays in `attempts`, which the admin card shows.)
    const doc = { ...base, status: 'needs-review' as const, brief, file: result.file, attempts: result.attempts };
    await ref.set(doc);
    if (existingId) this.renderer.removeByPrefix(existingId, result.file);
    this.logger.log(`Picture ${ref.id} for ${ctx.content}${ctx.usage ? ` (${ctx.usage})` : ''}: ${doc.status} after ${result.attempts.length} attempt(s)`);
    return { id: ref.id, ...doc };
  }

  private brief(ctx: SubjectContext, note?: string): Promise<PictureBrief> {
    if (!ctx.briefInput) return this.geminiService.generateFreePictureBrief(ctx.source.definition);
    const input = note?.trim() ? { ...ctx.briefInput, note: note.trim() } : ctx.briefInput;
    return ctx.briefRoute === '/pictures/brief'
      ? this.geminiService.generatePictureBrief(input, ctx.kuId!)
      : this.geminiService.generatePictureBrief(input, ctx.kuId!, ctx.briefRoute);
  }

  private usageContext(kuId: string, lesson: VocabLesson, source: PictureSource): SubjectContext {
    return {
      subject: { kind: 'ku-usage', kuId, usage: source.usage },
      kuId,
      content: lesson.vocab,
      reading: lesson.reading,
      usage: source.usage,
      source,
      briefInput: { word: lesson.vocab, reading: lesson.reading, ...source },
      briefRoute: '/pictures/brief',
    };
  }

  private freeContext(description: string): SubjectContext {
    const d = (description ?? '').trim();
    if (!d) throw new BadRequestException('A free-standing picture needs a note describing it');
    return {
      subject: { kind: 'none' },
      kuId: null,
      content: d.length > 60 ? `${d.slice(0, 57)}…` : d,
      reading: '',
      usage: '',
      source: { usage: '', definition: d, sentence: '', translation: '' },
      briefInput: null,
      briefRoute: '/pictures/brief-free',
    };
  }

  /** Validate a subject against the data and build its context (no Gemini calls). */
  private async resolveSubject(subject: PictureSubject): Promise<SubjectContext> {
    if (!subject || !SUBJECT_KINDS.includes(subject.kind)) throw new BadRequestException('Unknown subject kind');
    if (subject.kind === 'none') throw new BadRequestException('Use a note for a free-standing picture');
    if (!subject.kuId) throw new BadRequestException('subject.kuId is required');
    const kuId = subject.kuId;
    const [kuDoc, lessonDoc] = await Promise.all([
      this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(kuId).get(),
      this.db.collection(LESSONS_COLLECTION).doc(kuId).get(),
    ]);
    const lesson = lessonDoc.exists ? (lessonDoc.data() as Record<string, any>) : null;

    if (subject.kind === 'ku-usage') {
      if (!kuDoc.exists) throw new NotFoundException(`KU ${kuId} not found`);
      if (kuDoc.data()?.type !== 'Vocab') throw new BadRequestException(`KU ${kuId} is not Vocab`);
      if (!lesson) throw new BadRequestException(`KU ${kuId} has no lesson yet`);
      const sources = usageSources(lesson as VocabLesson);
      const source = subject.usage?.trim() ? sources.find(s => usageKey(s.usage) === usageKey(subject.usage)) : sources[0];
      if (!source) throw new BadRequestException(`"${subject.usage}" isn't one of this word's usages: ${sources.map(s => s.usage).join(', ')}`);
      return this.usageContext(kuId, lesson as VocabLesson, source);
    }

    // 'ku': a whole word, grammar point or Concept (Concepts live in their own collection).
    // Never a Kanji: AIGENKI doesn't teach kanji through pictures, and a word like 川
    // shares its content with its Kanji KU, so a content lookup can land on the wrong one.
    let ku = kuDoc.exists ? (kuDoc.data() as Record<string, any>) : null;
    if (!ku) {
      const conceptDoc = await this.db.collection(CONCEPTS_COLLECTION).doc(kuId).get();
      if (conceptDoc.exists) ku = { type: 'Concept', ...conceptDoc.data() };
    }
    if (!ku) throw new NotFoundException(`KU ${kuId} not found`);
    if (ku.type === 'Kanji') throw new BadRequestException(`KU ${kuId} is a Kanji; pictures attach to words, grammar or concepts`);
    const meaning = kuMeaning(ku, lesson);
    const word = ku.type === 'Vocab' ? (lesson?.vocab ?? ku.content) : ku.content;
    const reading = ku.type === 'Vocab' ? (lesson?.reading ?? ku.data?.reading ?? '') : (ku.data?.reading ?? '');
    return {
      subject: { kind: 'ku', kuId },
      kuId,
      content: word,
      reading,
      usage: '',
      source: { usage: '', definition: meaning, sentence: '', translation: '' },
      briefInput: { word, reading, usage: '', definition: meaning, sentence: '', translation: '' },
      briefRoute: '/pictures/brief-ku',
    };
  }

  /**
   * Attach an image made outside the system (e.g. a hand-made diagram) to a Vocab KU.
   * Stored like a generated picture, waiting in Needs Review, and marked
   * origin 'uploaded' so generation never redraws, replaces or cleans it up.
   */
  async upload(kuId: string | undefined, usage: string | undefined, image: UploadedImage, kind: PictureSubjectKind = 'ku-usage', note?: string): Promise<Picture> {
    if (!image.size || image.size > MAX_UPLOAD_BYTES) throw new BadRequestException('Image must be under 5 MB');
    const actual = sniffImage(image.buffer);
    if (!actual) throw new BadRequestException('File is not a PNG, JPEG or WebP image');
    const ext = IMAGE_EXT[actual];
    if (kind !== 'ku-usage') return this.uploadOther(kind, kuId, image, ext, note);
    if (!kuId) throw new BadRequestException('kuId is required');

    const [kuDoc, lessonDoc] = await Promise.all([
      this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(kuId).get(),
      this.db.collection(LESSONS_COLLECTION).doc(kuId).get(),
    ]);
    if (!kuDoc.exists) throw new NotFoundException(`KU ${kuId} not found`);
    if (kuDoc.data()?.type !== 'Vocab') throw new BadRequestException(`KU ${kuId} is not Vocab`);
    const lesson = lessonDoc.exists ? (lessonDoc.data() as VocabLesson) : null;
    const ku = kuDoc.data() as Record<string, any>;

    // Default the usage to the lesson's first usage, so the picture lines up with the slides.
    const sources = lesson ? usageSources(lesson) : [];
    const chosen = usage?.trim() ? sources.find(s => usageKey(s.usage) === usageKey(usage)) : sources[0];
    // A typed usage that matches none of the lesson's usages would never be shown: refuse it.
    if (usage?.trim() && !chosen && sources.length) {
      throw new BadRequestException(`"${usage.trim()}" isn't one of this word's usages: ${sources.map(s => s.usage).join(', ')}`);
    }
    const source: PictureSource = chosen ?? {
      usage: usage?.trim() || ku.data?.definition || ku.content,
      definition: (lesson?.definitions ?? [])[0] ?? ku.data?.definition ?? '',
      sentence: '',
      translation: '',
    };

    const ref = this.col().doc();
    this.ensureDir();
    const file = `${ref.id}-${Date.now()}.${ext}`;
    const filePath = path.join(this.dir, file);
    fs.writeFileSync(filePath, image.buffer);
    const doc = {
      kuId,
      content: lesson?.vocab ?? ku.content,
      reading: lesson?.reading ?? ku.data?.reading ?? '',
      subject: { kind: 'ku-usage' as const, kuId, usage: source.usage },
      usage: source.usage,
      source,
      status: 'needs-review' as const,
      origin: 'uploaded' as const,
      file,
      attempts: [],
      createdAt: Timestamp.now(),
    };
    try {
      await ref.set(doc);
    } catch (e) {
      fs.rmSync(filePath, { force: true }); // don't leave an orphaned file if the doc write fails
      throw e;
    }

    // Nothing else changes: the upload isn't bound to its usage until it's approved.
    this.logger.log(`Uploaded picture ${ref.id} for ${doc.content} (${doc.usage})`);
    return { id: ref.id, ...doc };
  }

  /** Upload for a whole KU ('ku') or as a free-standing asset ('none'). Waits in Needs Review. */
  private async uploadOther(kind: PictureSubjectKind, kuId: string | undefined, image: UploadedImage, ext: string, note?: string): Promise<Picture> {
    const ctx = kind === 'none' ? this.freeContext(note?.trim() || 'Uploaded image') : await this.resolveSubject({ kind, kuId });
    const ref = this.col().doc();
    const file = `${ref.id}-${Date.now()}.${ext}`;
    this.renderer.write(file, image.buffer);
    const doc = {
      kuId: ctx.kuId,
      subject: ctx.subject,
      content: ctx.content,
      reading: ctx.reading,
      usage: ctx.usage,
      source: ctx.source,
      ...(note?.trim() ? { note: note.trim() } : {}),
      status: 'needs-review' as const,
      origin: 'uploaded' as const,
      file,
      attempts: [],
      createdAt: Timestamp.now(),
    };
    try {
      await ref.set(doc);
    } catch (e) {
      this.renderer.remove(file);
      throw e;
    }
    this.logger.log(`Uploaded picture ${ref.id} for ${doc.content} (${kind})`);
    return { id: ref.id, ...doc };
  }

  /** Flags uploaded pictures whose usage is no longer one of their lesson's usages. */
  async annotateStale(pictures: Picture[]): Promise<AdminPicture[]> {
    const isUsageUpload = (p: Picture) => p.origin === 'uploaded' && subjectOf(p).kind === 'ku-usage' && !!p.kuId;
    const kuIds = [...new Set(pictures.filter(isUsageUpload).map(p => p.kuId!))];
    if (!kuIds.length) return pictures;
    const col = this.db.collection(LESSONS_COLLECTION);
    const lessons = await this.db.getAll(...kuIds.map(id => col.doc(id)));
    const usages = new Map<string, Set<string>>();
    lessons.forEach((l, i) => {
      if (l.exists) usages.set(kuIds[i], new Set(usageSources(l.data() as VocabLesson).map(s => usageKey(s.usage))));
    });
    return pictures.map(p =>
      isUsageUpload(p) && usages.has(p.kuId!) && !usages.get(p.kuId!)!.has(usageKey(p.usage))
        ? { ...p, staleUsage: true }
        : p,
    );
  }

  /**
   * Distractors for the four-picture choice card: one approved picture from each of `n`
   * other words, preferring words the user has enrolled (familiar pictures make the card
   * test the sound, not novelty), topped up at random from the rest.
   */
  async choices(uid: string, kuId: string, n = 3): Promise<{ id: string; file: string; kuId: string }[]> {
    const [approved, enrolled] = await Promise.all([
      this.col().where('status', '==', 'approved').get(),
      this.db.collection('users').doc(uid).collection(USER_KUS_SUBCOLLECTION).select('kuId').get(),
    ]);
    const mine = new Set(enrolled.docs.map(d => (d.data().kuId as string) ?? d.id));
    const byKu = new Map<string, { id: string; file: string; kuId: string }[]>();
    for (const d of approved.docs) {
      const k = d.data().kuId as string;
      if (!k || k === kuId || !d.data().file || !isUsagePicture(d.data())) continue;
      if (!byKu.has(k)) byKu.set(k, []);
      byKu.get(k)!.push({ id: d.id, file: d.data().file, kuId: k });
    }
    const shuffle = <T>(a: T[]) => a.map(x => [Math.random(), x] as const).sort((x, y) => x[0] - y[0]).map(x => x[1]);
    const ordered = [...shuffle([...byKu.keys()].filter(k => mine.has(k))), ...shuffle([...byKu.keys()].filter(k => !mine.has(k)))];
    return ordered.slice(0, n).map(k => shuffle(byKu.get(k)!)[0]);
  }

  private async hasActiveUpload(kuId: string, usage: string): Promise<boolean> {
    const snap = await this.col().where('kuId', '==', kuId).get();
    return snap.docs.some(
      d => isUsagePicture(d.data()) && d.data().origin === 'uploaded' && d.data().status !== 'rejected' && usageKey(d.data().usage) === usageKey(usage),
    );
  }

  private async deletePicture(id: string, file?: string) {
    if (file) this.renderer.remove(file);
    await this.col().doc(id).delete();
  }

  /** Vocab KUs with a lesson whose pictures don't cover every usage yet (scans lessons; fine at hundreds). */
  private async vocabMissingPictures(limit: number): Promise<string[]> {
    const [lessons, pictures] = await Promise.all([
      this.db.collection(LESSONS_COLLECTION).where('type', '==', 'Vocab').get(),
      this.col().select('kuId', 'usage', 'subject').get(),
    ]);
    const key = usageKey;
    const have = new Map<string, Set<string>>();
    for (const d of pictures.docs) {
      if (!isUsagePicture(d.data())) continue;
      const k = d.data().kuId as string;
      if (!have.has(k)) have.set(k, new Set());
      have.get(k)!.add(key(d.data().usage ?? ''));
    }
    const candidates = lessons.docs.filter(d =>
      usageSources(d.data() as VocabLesson).some(s => !have.get(d.id)?.has(key(s.usage))),
    );
    if (!candidates.length) return [];
    // Lessons can outlive their KU (deleting a KU leaves its lesson behind): only pick
    // lessons whose KU still exists and is Vocab, or the batch fills up with failures.
    const kuCol = this.db.collection(KNOWLEDGE_UNITS_COLLECTION);
    const kus = await this.db.getAll(...candidates.map(d => kuCol.doc(d.id)));
    return candidates
      .filter((_, i) => kus[i].exists && kus[i].data()?.type === 'Vocab')
      .map(d => d.id)
      .slice(0, limit);
  }
}

/**
 * Which usages get a picture — the same rule as the Start Learning slides
 * (frontend LessonSlides.vocabExampleSlides): the first example of each distinct
 * usage when every example is labelled, otherwise just the first example. No cap: every
 * usage the slides teach gets a picture. (No examples at all → one definition-based picture.)
 */
/** Does every example carry a usage label? If not, usageSources() falls back to one usage. */
export function usagesLabelled(lesson: VocabLesson): boolean {
  const examples = lesson.context_examples ?? [];
  return examples.length > 0 && examples.every(e => e.usage?.trim());
}

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
    const key = usageKey(e.usage);
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ usage: e.usage!.trim(), definition, sentence: strip(e.sentence), translation: e.translation });
  }
  return sources;
}

/** Throws unless `b` is a complete brief (edited briefs come from the admin UI and the CLI). */
export function assertBrief(b: any): asserts b is PictureBrief {
  const ok =
    b && typeof b.picturable === 'boolean' && typeof b.includeCast === 'boolean' &&
    typeof b.background === 'string' && typeof b.scene === 'string' && b.scene.trim().length > 0;
  if (!ok) throw new BadRequestException('brief needs picturable, includeCast, background and a non-empty scene');
}

/** One line saying what a whole KU means, for its brief. */
function kuMeaning(ku: Record<string, any>, lesson: Record<string, any> | null): string {
  const d = ku.data ?? {};
  switch (ku.type) {
    case 'Vocab':
      return (lesson?.definitions ?? [])[0] ?? lesson?.definition ?? d.definition ?? ku.content;
    case 'Grammar':
      return [d.title, lesson?.meaning].filter(Boolean).join(': ') || ku.content;
    case 'Concept':
      return [d.title, d.overview].filter(Boolean).join(': ') || ku.content;
    case 'Kanji':
      return d.meaning ?? lesson?.meaning ?? ku.content;
    default:
      return ku.content;
  }
}
