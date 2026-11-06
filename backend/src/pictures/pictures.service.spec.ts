import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { PicturesService, subjectOf, usageSources, usagesLabelled } from './pictures.service';
import { PictureRenderer } from './picture-renderer';

// ─── Minimal in-memory Firestore (only what PicturesService uses) ────────────

type Data = Record<string, any>;
let autoId = 0;
let currentDb: FakeDb; // for subcollections (users/{uid}/user-kus)

class FakeDocRef {
  constructor(private readonly store: Map<string, Data>, readonly id: string) {}
  async get() {
    const d = this.store.get(this.id);
    return { id: this.id, exists: !!d, data: () => (d ? { ...d } : undefined), ref: this };
  }
  async set(data: Data) {
    this.store.set(this.id, { ...data });
  }
  async update(data: Data) {
    const cur = this.store.get(this.id);
    if (!cur) throw new Error(`update of missing doc ${this.id}`);
    const next = { ...cur, ...data };
    for (const [k, v] of Object.entries(data)) if (v instanceof FieldValue && v.isEqual(FieldValue.delete())) delete next[k];
    this.store.set(this.id, next);
  }
  async delete() {
    this.store.delete(this.id);
  }
  collection(name: string) {
    return currentDb.collection(`sub/${this.id}/${name}`);
  }
}

class FakeQuery {
  constructor(
    protected readonly store: Map<string, Data>,
    private readonly filters: [string, any][] = [],
  ) {}
  where(field: string, _op: '==', value: any) {
    return new FakeQuery(this.store, [...this.filters, [field, value]]);
  }
  select(..._fields: string[]) {
    return this;
  }
  limit(_n: number) {
    return this;
  }
  async get() {
    const docs = [...this.store.entries()]
      .filter(([, d]) => this.filters.every(([f, v]) => d[f] === v))
      .map(([id, d]) => ({ id, exists: true, data: () => ({ ...d }), ref: new FakeDocRef(this.store, id) }));
    return { empty: docs.length === 0, size: docs.length, docs };
  }
}

class FakeCollection extends FakeQuery {
  doc(id?: string) {
    return new FakeDocRef(this.store, id ?? `auto${++autoId}`);
  }
}

class FakeDb {
  readonly stores = new Map<string, Map<string, Data>>();
  async getAll(...refs: FakeDocRef[]) {
    return Promise.all(refs.map(r => r.get()));
  }
  collection(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    return new FakeCollection(this.stores.get(name)!);
  }
  docs(name: string) {
    return [...(this.stores.get(name) ?? new Map()).entries()].map(([id, d]) => ({ id, ...d }));
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ts = { toMillis: () => 0 };

function vocabLesson(examples: { sentence: string; translation: string; usage?: string }[], definitions = ['def']) {
  return { type: 'Vocab', vocab: '掛かる', reading: 'かかる', definitions, context_examples: examples };
}

const ex = (usage?: string, n = 1) => ({ sentence: `文${n}[ぶん]。`, translation: `sentence ${n}`, usage });

const okBrief = { picturable: true, includeCast: false, background: 'none', scene: 'a scene' };

describe('PicturesService', () => {
  let db: FakeDb;
  let dir: string;
  let gemini: {
    generatePictureBrief: jest.Mock;
    generateFreePictureBrief: jest.Mock;
    generatePicture: jest.Mock;
    checkPictureForText: jest.Mock;
  };
  let service: PicturesService;

  const KU = 'ku1';

  function seed(lesson: Data, type = 'Vocab') {
    db.collection('knowledge-units').doc(KU).set({ type, content: lesson.vocab });
    db.collection('lessons').doc(KU).set(lesson);
  }

  /** An existing picture doc (and its file on disk, when it has one). */
  function existingPicture(id: string, usage: string, status: string, withFile = true) {
    const file = withFile ? `${id}-1.png` : undefined;
    if (file) fs.writeFileSync(path.join(dir, file), 'old');
    db.collection('pictures').doc(id).set({ kuId: KU, usage, status, file, source: { usage }, attempts: [], createdAt: ts });
  }

  const pictures = () => db.docs('pictures');

  beforeEach(() => {
    autoId = 0;
    db = new FakeDb();
    currentDb = db;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pictures-spec-'));
    gemini = {
      generatePictureBrief: jest.fn().mockResolvedValue(okBrief),
      generateFreePictureBrief: jest.fn().mockResolvedValue(okBrief),
      generatePicture: jest.fn().mockResolvedValue({ data: Buffer.from('img'), mimeType: 'image/png' }),
      checkPictureForText: jest.fn().mockResolvedValue({ hasText: false, where: 'none' }),
    };
    const config = { get: (k: string) => (k === 'PICTURES_DIR' ? dir : undefined) };
    service = new PicturesService(db as any, gemini as any, config as any, new PictureRenderer(gemini as any, config as any));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('usageSources (same rule as the Start Learning slides)', () => {
    it('gives the first example of each distinct usage when every example is labelled', () => {
      const s = usageSources(vocabLesson([ex('time', 1), ex('Time ', 2), ex('cost', 3)]) as any);
      expect(s.map(x => x.usage)).toEqual(['time', 'cost']);
      expect(s[0].sentence).toBe('文1。'); // furigana stripped
    });

    it('falls back to the first example when any example is unlabelled', () => {
      const s = usageSources(vocabLesson([ex('time', 1), ex(undefined, 2)], ['to take']) as any);
      expect(s).toHaveLength(1);
      expect(s[0].usage).toBe('to take');
    });

    it('has no cap: four usages give four sources', () => {
      const s = usageSources(vocabLesson([ex('a', 1), ex('b', 2), ex('c', 3), ex('d', 4)]) as any);
      expect(s).toHaveLength(4);
    });

    it('uses the definition when there are no examples', () => {
      const s = usageSources(vocabLesson([], ['to hang']) as any);
      expect(s).toEqual([{ usage: 'to hang', definition: 'to hang', sentence: '', translation: '' }]);
    });
  });

  describe('generateForKu', () => {
    it('creates one picture per usage, waiting in Needs Review, with its file on disk', async () => {
      seed(vocabLesson([ex('time', 1), ex('cost', 2)]));
      const { pictures: made, failed } = await service.generateForKu(KU);
      expect(failed).toBe(0);
      expect(made.map(p => [p.usage, p.status])).toEqual([['time', 'needs-review'], ['cost', 'needs-review']]);
      for (const p of made) expect(fs.existsSync(path.join(dir, p.file!))).toBe(true);
    });

    it('records an unpicturable brief without calling the image model', async () => {
      seed(vocabLesson([ex('particle', 1)]));
      gemini.generatePictureBrief.mockResolvedValue({ ...okBrief, picturable: false });
      const { pictures: made } = await service.generateForKu(KU);
      expect(made[0].status).toBe('unpicturable');
      expect(made[0].file).toBeUndefined();
      expect(gemini.generatePicture).not.toHaveBeenCalled();
    });

    it('rejects non-Vocab KUs and KUs without a lesson', async () => {
      db.collection('knowledge-units').doc(KU).set({ type: 'Grammar' });
      db.collection('lessons').doc(KU).set(vocabLesson([ex('x')]));
      await expect(service.generateForKu(KU)).rejects.toBeInstanceOf(BadRequestException);
      db.collection('knowledge-units').doc('ku2').set({ type: 'Vocab' });
      await expect(service.generateForKu('ku2')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('one usage failing does not stop the others', async () => {
      seed(vocabLesson([ex('time', 1), ex('cost', 2), ex('hang', 3)]));
      gemini.generatePictureBrief
        .mockResolvedValueOnce(okBrief)
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(okBrief);
      const { pictures: made, failed } = await service.generateForKu(KU);
      expect(failed).toBe(1);
      expect(made.map(p => p.usage)).toEqual(['time', 'hang']);
    });

    it('normal run only fills usages that have no picture yet', async () => {
      seed(vocabLesson([ex('time', 1), ex('cost', 2)]));
      existingPicture('old', 'time', 'approved');
      const { pictures: made } = await service.generateForKu(KU);
      expect(made.map(p => p.usage)).toEqual(['cost']);
      expect(pictures().map(p => p.id).sort()).toEqual(['auto1', 'old']);
    });

    it('retries until the text check passes, keeping all attempts', async () => {
      seed(vocabLesson([ex('time', 1)]));
      gemini.checkPictureForText
        .mockResolvedValueOnce({ hasText: true, where: 'a sign' })
        .mockResolvedValueOnce({ hasText: false, where: 'none' });
      const { pictures: made } = await service.generateForKu(KU);
      expect(made[0].status).toBe('needs-review'); // a clean image still waits for the admin
      expect(made[0].attempts.map(a => a.hasText)).toEqual([true, false]);
      expect(gemini.generatePicture).toHaveBeenCalledTimes(2);
    });

    it('ends as needs-review (with the last image) when every attempt has text', async () => {
      seed(vocabLesson([ex('time', 1)]));
      gemini.checkPictureForText.mockResolvedValue({ hasText: true, where: 'a sign' });
      const { pictures: made } = await service.generateForKu(KU);
      expect(made[0].status).toBe('needs-review');
      expect(made[0].attempts).toHaveLength(3);
      expect(fs.existsSync(path.join(dir, made[0].file!))).toBe(true);
    });

    it('keeps an earlier image for review when a later attempt errors', async () => {
      seed(vocabLesson([ex('time', 1)]));
      gemini.checkPictureForText.mockResolvedValueOnce({ hasText: true, where: 'a sign' });
      gemini.generatePicture
        .mockResolvedValueOnce({ data: Buffer.from('first'), mimeType: 'image/png' })
        .mockRejectedValueOnce(new Error('No image returned (finishReason=IMAGE_SAFETY)'));
      const { pictures: made, failed } = await service.generateForKu(KU);
      expect(failed).toBe(0);
      expect(made[0].status).toBe('needs-review');
      expect(fs.readFileSync(path.join(dir, made[0].file!), 'utf8')).toBe('first');
    });

    it('names the file from the returned MIME type and passes it to the text check', async () => {
      seed(vocabLesson([ex('time', 1)]));
      gemini.generatePicture.mockResolvedValue({ data: Buffer.from('jpg'), mimeType: 'image/jpeg' });
      const { pictures: made } = await service.generateForKu(KU);
      expect(made[0].file).toMatch(/\.jpg$/);
      expect(gemini.checkPictureForText).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg', KU);
    });
  });

  describe('forced replace never loses an approved picture to a worse one', () => {
    it('a clean replacement waits in Needs Review beside the old approved picture', async () => {
      seed(vocabLesson([ex('time', 1)]));
      existingPicture('old', 'time', 'approved');
      await service.generateForKu(KU, true);
      const byId = Object.fromEntries(pictures().map(p => [p.id, p.status]));
      expect(byId).toEqual({ old: 'approved', auto1: 'needs-review' });
      expect(fs.existsSync(path.join(dir, 'old-1.png'))).toBe(true);
    });

    it('a needs-review replacement leaves the old approved picture in place', async () => {
      seed(vocabLesson([ex('time', 1)]));
      existingPicture('old', 'time', 'approved');
      gemini.checkPictureForText.mockResolvedValue({ hasText: true, where: 'a sign' });
      await service.generateForKu(KU, true);
      const byId = Object.fromEntries(pictures().map(p => [p.id, p.status]));
      expect(byId).toEqual({ old: 'approved', auto1: 'needs-review' });
      expect(fs.existsSync(path.join(dir, 'old-1.png'))).toBe(true);
    });

    it('an unpicturable result leaves the old approved picture in place', async () => {
      seed(vocabLesson([ex('time', 1)]));
      existingPicture('old', 'time', 'approved');
      gemini.generatePictureBrief.mockResolvedValue({ ...okBrief, picturable: false });
      await service.generateForKu(KU, true);
      expect(pictures().find(p => p.id === 'old')?.status).toBe('approved');
    });

    it('a failed replacement leaves the old approved picture in place', async () => {
      seed(vocabLesson([ex('time', 1)]));
      existingPicture('old', 'time', 'approved');
      gemini.generatePictureBrief.mockRejectedValue(new Error('boom'));
      const { failed } = await service.generateForKu(KU, true);
      expect(failed).toBe(1);
      expect(pictures().map(p => p.id)).toEqual(['old']);
    });
  });

  describe('stale pictures (usage no longer exists, e.g. after a relabel)', () => {
    it('are removed once the word has an image for a current usage (normal run)', async () => {
      seed(vocabLesson([ex('practice', 1), ex('practice', 2)]));
      existingPicture('stale1', 'practicing a skill', 'approved');
      existingPicture('stale2', 'practice session (noun)', 'approved');
      await service.generateForKu(KU);
      expect(pictures().map(p => p.usage)).toEqual(['practice']);
      expect(fs.readdirSync(dir).filter(f => f.startsWith('stale'))).toEqual([]);
    });

    it('are kept when every new picture for the current usages fails', async () => {
      seed(vocabLesson([ex('practice', 1)]));
      existingPicture('stale1', 'practicing a skill', 'approved');
      gemini.generatePictureBrief.mockRejectedValue(new Error('boom'));
      await service.generateForKu(KU);
      expect(pictures().map(p => p.id)).toEqual(['stale1']);
    });

    it('are kept when the only current picture is unpicturable (no image)', async () => {
      seed(vocabLesson([ex('practice', 1)]));
      existingPicture('stale1', 'practicing a skill', 'approved');
      gemini.generatePictureBrief.mockResolvedValue({ ...okBrief, picturable: false });
      await service.generateForKu(KU);
      expect(pictures().some(p => p.id === 'stale1')).toBe(true);
    });
  });

  describe('redraw', () => {
    it('redraws in the background, replaces the file and keeps the id', async () => {
      seed(vocabLesson([ex('time', 1)]));
      existingPicture('p1', 'time', 'needs-review');
      await service.startRedraw('p1');
      expect(service.getJob().redrawing).toEqual(['p1']);
      await new Promise(r => setImmediate(r));
      await waitFor(() => service.getJob().redrawing.length === 0);
      const p = pictures().find(x => x.id === 'p1')!;
      expect(p.status).toBe('needs-review');
      expect(p.file).not.toBe('p1-1.png');
      expect(fs.readdirSync(dir).filter(f => f.startsWith('p1-'))).toEqual([p.file]);
    });

    it('a second redraw of the same picture is refused while one is running', async () => {
      seed(vocabLesson([ex('time', 1)]));
      existingPicture('p1', 'time', 'approved');
      let release!: () => void;
      gemini.generatePictureBrief.mockImplementation(() => new Promise(r => (release = () => r(okBrief))));
      const first = service.startRedraw('p1');
      await expect(service.startRedraw('p1')).rejects.toBeInstanceOf(BadRequestException);
      await first;
      await waitFor(() => !!release);
      release();
      await waitFor(() => service.getJob().redrawing.length === 0);
    });

    it('a forced generation does not delete a picture that is mid-redraw', async () => {
      seed(vocabLesson([ex('time', 1)]));
      existingPicture('p1', 'time', 'approved');
      let release!: () => void;
      gemini.generatePictureBrief.mockImplementationOnce(() => new Promise(r => (release = () => r(okBrief))));
      await service.startRedraw('p1');
      await service.generateForKu(KU, true); // a replacement for 'time'
      expect(pictures().some(p => p.id === 'p1')).toBe(true);
      await waitFor(() => !!release);
      release();
      await waitFor(() => service.getJob().redrawing.length === 0);
    });

    it('an unpicturable redraw removes the old image file', async () => {
      seed(vocabLesson([ex('time', 1)]));
      existingPicture('p1', 'time', 'approved');
      gemini.generatePictureBrief.mockResolvedValue({ ...okBrief, picturable: false });
      await service.startRedraw('p1');
      await waitFor(() => service.getJob().redrawing.length === 0);
      expect(fs.existsSync(path.join(dir, 'p1-1.png'))).toBe(false);
      expect(pictures().find(p => p.id === 'p1')?.status).toBe('unpicturable');
    });
  });

  describe('uploaded pictures (made outside the system)', () => {
    const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const png = (body = 'diagram') => {
      const buffer = Buffer.concat([PNG_MAGIC, Buffer.from(body)]);
      return { buffer, mimetype: 'image/png', size: buffer.length };
    };

    function uploadedPicture(id: string, usage: string) {
      fs.writeFileSync(path.join(dir, `${id}-1.png`), 'up');
      db.collection('pictures').doc(id).set({
        kuId: KU, usage, status: 'approved', origin: 'uploaded', file: `${id}-1.png`, source: { usage }, attempts: [], createdAt: ts,
      });
    }

    it('upload stores an uploaded picture, waiting in Needs Review, with its file', async () => {
      seed(vocabLesson([ex('time', 1), ex('cost', 2)]));
      const pic = await service.upload(KU, 'COST', png());
      expect(pic).toMatchObject({ status: 'needs-review', origin: 'uploaded', usage: 'cost', kuId: KU });
      expect(fs.readFileSync(path.join(dir, pic.file!)).subarray(8).toString()).toBe('diagram');
    });

    it('upload defaults the usage to the lesson\'s first usage', async () => {
      seed(vocabLesson([ex('time', 1), ex('cost', 2)]));
      expect((await service.upload(KU, undefined, png())).usage).toBe('time');
    });

    it('upload rejects unsupported types, empty files and non-Vocab KUs', async () => {
      seed(vocabLesson([ex('time', 1)]));
      await expect(service.upload(KU, undefined, { buffer: Buffer.from('x'), mimetype: 'image/gif', size: 1 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.upload(KU, undefined, { buffer: Buffer.alloc(0), mimetype: 'image/png', size: 0 })).rejects.toBeInstanceOf(BadRequestException);
      db.collection('knowledge-units').doc('g').set({ type: 'Grammar' });
      await expect(service.upload('g', undefined, png())).rejects.toBeInstanceOf(BadRequestException);
    });

    it('forced generation never replaces an upload nor generates over its usage', async () => {
      seed(vocabLesson([ex('time', 1), ex('cost', 2)]));
      uploadedPicture('up1', 'time');
      const { pictures: made } = await service.generateForKu(KU, true);
      expect(made.map(p => p.usage)).toEqual(['cost']);
      expect(pictures().find(p => p.id === 'up1')).toBeDefined();
      expect(fs.existsSync(path.join(dir, 'up1-1.png'))).toBe(true);
    });

    it('stale cleanup leaves an upload whose usage no longer exists', async () => {
      seed(vocabLesson([ex('practice', 1)]));
      uploadedPicture('up1', 'old usage');
      await service.generateForKu(KU);
      expect(pictures().some(p => p.id === 'up1')).toBe(true);
    });

    it('annotateStale flags uploads whose usage is gone, and nothing else', async () => {
      seed(vocabLesson([ex('practice', 1)]));
      uploadedPicture('up1', 'old usage');
      uploadedPicture('up2', 'practice');
      existingPicture('gen', 'gone too', 'approved');
      const annotated = await service.annotateStale(await service.list({}));
      const stale = Object.fromEntries(annotated.map(p => [p.id, !!p.staleUsage]));
      expect(stale).toEqual({ up1: true, up2: false, gen: false });
    });

    it('upload checks the real file type, not the claimed one', async () => {
      seed(vocabLesson([ex('time', 1)]));
      const html = Buffer.from('<html><script>x</script></html>');
      await expect(service.upload(KU, undefined, { buffer: html, mimetype: 'image/png', size: html.length }))
        .rejects.toBeInstanceOf(BadRequestException);
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
      expect((await service.upload(KU, undefined, { buffer: jpeg, mimetype: 'image/png', size: jpeg.length })).file).toMatch(/\.jpg$/);
    });

    it('upload refuses a usage that is not one of the lesson\'s usages', async () => {
      seed(vocabLesson([ex('time', 1), ex('cost', 2)]));
      await expect(service.upload(KU, 'costs', png())).rejects.toThrow(/time, cost/);
    });

    it('upload leaves the other pictures for its usage alone (it is not bound until approved)', async () => {
      seed(vocabLesson([ex('time', 1), ex('cost', 2)]));
      existingPicture('gen-time', 'time', 'approved');
      const up = await service.upload(KU, 'time', png());
      const status = Object.fromEntries(pictures().map(p => [p.id, p.status]));
      expect(status).toEqual({ 'gen-time': 'approved', [up.id]: 'needs-review' });
    });

    it('a failed doc write removes the uploaded file', async () => {
      seed(vocabLesson([ex('time', 1)]));
      const spy = jest.spyOn(FakeDocRef.prototype, 'set').mockImplementationOnce(() => Promise.reject(new Error('firestore down')));
      await expect(service.upload(KU, undefined, png())).rejects.toThrow('firestore down');
      expect(fs.readdirSync(dir)).toEqual([]);
      spy.mockRestore();
    });

    it('a rejected upload no longer blocks generation for its usage', async () => {
      seed(vocabLesson([ex('time', 1)]));
      uploadedPicture('up1', 'time');
      await service.setStatus('up1', 'rejected');
      const { pictures: made } = await service.generateForKu(KU, true);
      expect(made.map(p => p.usage)).toEqual(['time']);
    });

    it('an upload that arrives mid-generation wins its usage', async () => {
      seed(vocabLesson([ex('time', 1), ex('cost', 2)]));
      gemini.generatePictureBrief.mockImplementationOnce(async () => {
        uploadedPicture('late', 'cost'); // uploaded while 'time' is being drawn
        return okBrief;
      });
      const { pictures: made } = await service.generateForKu(KU);
      expect(made.map(p => p.usage)).toEqual(['time']);
    });

    it('uploaded pictures cannot be redrawn', async () => {
      seed(vocabLesson([ex('time', 1)]));
      uploadedPicture('up1', 'time');
      await expect(service.startRedraw('up1')).rejects.toBeInstanceOf(BadRequestException);
      expect(service.getJob().redrawing).toEqual([]);
    });
  });

  describe('setStatus', () => {
    it('refuses to approve a picture without an image', async () => {
      existingPicture('u1', 'particle', 'unpicturable', false);
      await expect(service.setStatus('u1', 'approved')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('can reject any picture', async () => {
      existingPicture('p1', 'time', 'approved');
      expect((await service.setStatus('p1', 'rejected')).status).toBe('rejected');
    });
  });

  describe('choices (distractors for the four-picture card)', () => {
    const approved = (id: string, kuId: string, status = 'approved') =>
      db.collection('pictures').doc(id).set({ kuId, usage: 'u', status, file: `${id}-1.png`, attempts: [], createdAt: ts });

    it('one approved picture per other word, never the word itself or unapproved ones', async () => {
      approved('self', KU);
      approved('a1', 'kuA');
      approved('a2', 'kuA');
      approved('b1', 'kuB');
      approved('r1', 'kuR', 'rejected');
      const picks = await service.choices('user1', KU, 3);
      expect(picks.map(p => p.kuId).sort()).toEqual(['kuA', 'kuB']);
    });

    it('prefers words the user has enrolled', async () => {
      for (const k of ['k1', 'k2', 'k3', 'k4', 'k5', 'mine']) approved(`p-${k}`, k);
      db.collection('users').doc('user1').collection('user-kus').doc('x').set({ kuId: 'mine' });
      for (let i = 0; i < 10; i++) {
        const picks = await service.choices('user1', KU, 1);
        expect(picks[0].kuId).toBe('mine');
      }
    });
  });

  describe('startGeneration', () => {
    it('de-duplicates KU ids', async () => {
      seed(vocabLesson([ex('time', 1)]));
      await service.startGeneration({ kuIds: [KU, KU] });
      await waitFor(() => !service.getJob().running);
      expect(service.getJob().total).toBe(1);
      expect(pictures()).toHaveLength(1);
    });

    it('refuses a second job while one is running', async () => {
      seed(vocabLesson([ex('time', 1)]));
      gemini.generatePictureBrief.mockImplementation(() => new Promise(() => {})); // never settles
      await service.startGeneration({ kuIds: [KU] });
      await expect(service.startGeneration({ kuIds: [KU] })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('the missing-pictures batch picks words whose usages are not all covered', async () => {
      seed(vocabLesson([ex('time', 1), ex('cost', 2)]));
      existingPicture('old', 'time', 'approved');
      db.collection('knowledge-units').doc('done').set({ type: 'Vocab' });
      db.collection('lessons').doc('done').set(vocabLesson([ex('x', 1)]));
      db.collection('pictures').doc('d1').set({ kuId: 'done', usage: 'x', status: 'approved', file: 'd1-1.png', attempts: [], createdAt: ts });
      const ids = await (service as any).vocabMissingPictures(10);
      expect(ids).toEqual([KU]);
    });

    it('the missing-pictures batch skips lessons whose KU was deleted or is not Vocab', async () => {
      seed(vocabLesson([ex('time', 1)]));
      db.collection('lessons').doc('orphan').set(vocabLesson([ex('x', 1)])); // no KU at all
      db.collection('knowledge-units').doc('gram').set({ type: 'Grammar' });
      db.collection('lessons').doc('gram').set(vocabLesson([ex('y', 1)])); // stray Vocab-shaped lesson
      const ids = await (service as any).vocabMissingPictures(10);
      expect(ids).toEqual([KU]);
    });
  });

  describe('subjects and fine-grained steps', () => {
    const doneRendering = () => waitFor(() => service.getJob().rendering.length === 0);

    it('reads a doc without a subject as a Vocab usage picture', () => {
      expect(subjectOf({ kuId: KU, usage: 'time' })).toEqual({ kind: 'ku-usage', kuId: KU, usage: 'time' });
      expect(subjectOf({ kuId: null, subject: { kind: 'none' } })).toEqual({ kind: 'none' });
    });

    it('drafts a brief for a usage, passing the note, and saves nothing', async () => {
      seed(vocabLesson([ex('time', 1), ex('cost', 2)]));
      const brief = await service.draftBrief({ kind: 'ku-usage', kuId: KU, usage: 'Cost' }, 'Fude on the left');
      expect(brief).toEqual(okBrief);
      expect(gemini.generatePictureBrief).toHaveBeenCalledWith(
        expect.objectContaining({ usage: 'cost', sentence: '文2。', note: 'Fude on the left' }),
        KU,
      );
      expect(pictures()).toEqual([]);
    });

    it('refuses a usage the word does not have, listing the real ones', async () => {
      seed(vocabLesson([ex('time', 1), ex('cost', 2)]));
      await expect(service.draftBrief({ kind: 'ku-usage', kuId: KU, usage: 'weight' })).rejects.toThrow(/time, cost/);
    });

    it('makes a whole-KU picture for a Grammar KU in the background', async () => {
      db.collection('knowledge-units').doc('g1').set({ type: 'Grammar', content: '〜てあげる', data: { title: 'Doing a favour' } });
      const { id } = await service.create({ subject: { kind: 'ku', kuId: 'g1' } });
      expect(service.getJob().rendering.map(r => r.id)).toEqual([id]);
      await doneRendering();
      const p = pictures().find(x => x.id === id)!;
      expect(p).toMatchObject({ kuId: 'g1', usage: '', status: 'needs-review', subject: { kind: 'ku', kuId: 'g1' } });
      expect(gemini.generatePictureBrief).toHaveBeenCalledWith(expect.objectContaining({ definition: 'Doing a favour' }), 'g1', '/pictures/brief-ku');
      expect(fs.existsSync(path.join(dir, p.file))).toBe(true);
    });

    it('makes a free-standing picture from a note, with no KU', async () => {
      const { id } = await service.create({ note: 'Fude waving hello' });
      await doneRendering();
      expect(gemini.generateFreePictureBrief).toHaveBeenCalledWith('Fude waving hello');
      expect(pictures().find(x => x.id === id)).toMatchObject({ kuId: null, subject: { kind: 'none' }, note: 'Fude waving hello' });
    });

    it('a free-standing picture needs a description', async () => {
      await expect(service.create({})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('renders a given brief as-is (no brief call) in the requested style', async () => {
      const brief = { ...okBrief, scene: 'a quiet station platform' };
      const { id } = await service.create({ brief, style: 'scene' });
      await doneRendering();
      expect(gemini.generateFreePictureBrief).not.toHaveBeenCalled();
      expect(gemini.generatePicture).toHaveBeenCalledWith(brief, [], id, 'scene');
      expect(pictures().find(x => x.id === id)).toMatchObject({ style: 'scene', brief });
    });

    it('rejects an incomplete brief', async () => {
      await expect(service.create({ brief: { scene: '' } as any, note: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('batch generation ignores whole-KU pictures on the same word (no cover, no cleanup)', async () => {
      seed(vocabLesson([ex('time', 1)]));
      db.collection('pictures').doc('whole').set({
        kuId: KU, usage: '', subject: { kind: 'ku', kuId: KU }, status: 'approved', file: 'whole-1.png', source: { usage: '' }, attempts: [], createdAt: ts,
      });
      fs.writeFileSync(path.join(dir, 'whole-1.png'), 'w');
      const { pictures: made } = await service.generateForKu(KU, true);
      expect(made.map(p => p.usage)).toEqual(['time']);
      expect(pictures().some(p => p.id === 'whole')).toBe(true);
    });

    it('redraws with an edited brief without a brief call', async () => {
      seed(vocabLesson([ex('time', 1)]));
      existingPicture('p1', 'time', 'needs-review');
      const brief = { ...okBrief, scene: 'edited scene' };
      await service.redraw('p1', { brief });
      await waitFor(() => service.getJob().redrawing.length === 0);
      expect(gemini.generatePictureBrief).not.toHaveBeenCalled();
      expect(pictures().find(p => p.id === 'p1')).toMatchObject({ brief, status: 'needs-review', usage: 'time' });
    });

    it('redraws with a note that steers the new brief', async () => {
      seed(vocabLesson([ex('time', 1)]));
      existingPicture('p1', 'time', 'needs-review');
      await service.redraw('p1', { note: 'show a clock' });
      await waitFor(() => service.getJob().redrawing.length === 0);
      expect(gemini.generatePictureBrief).toHaveBeenCalledWith(expect.objectContaining({ usage: 'time', note: 'show a clock' }), KU);
      expect(pictures().find(p => p.id === 'p1')?.note).toBe('show a clock');
    });

    it('a plain redraw keeps the saved note (and steers the brief with it)', async () => {
      seed(vocabLesson([ex('time', 1)]));
      existingPicture('p1', 'time', 'needs-review');
      await db.collection('pictures').doc('p1').update({ note: 'show a clock' });
      await service.redraw('p1', {});
      await waitFor(() => service.getJob().redrawing.length === 0);
      expect(gemini.generatePictureBrief).toHaveBeenCalledWith(expect.objectContaining({ usage: 'time', note: 'show a clock' }), KU);
      expect(pictures().find(p => p.id === 'p1')?.note).toBe('show a clock');
    });

    it('the learner list narrowed to usage pictures leaves out whole-KU ones', async () => {
      seed(vocabLesson([ex('time', 1)]));
      existingPicture('p1', 'time', 'approved'); // old doc, no subject = usage picture
      db.collection('pictures').doc('p2').set({ kuId: KU, usage: '', subject: { kind: 'ku', kuId: KU }, status: 'approved', file: 'p2.png', createdAt: ts });
      const all = await service.list({ kuId: KU, status: 'approved' });
      const usage = await service.list({ kuId: KU, status: 'approved', kind: 'ku-usage' });
      expect(all.map(p => p.id).sort()).toEqual(['p1', 'p2']);
      expect(usage.map(p => p.id)).toEqual(['p1']);
    });

    it('never attaches a whole-KU picture to a Kanji (川 shares content with its Kanji KU)', async () => {
      seed(vocabLesson([ex('river', 1)]));
      existingPicture('p1', 'river', 'approved');
      db.collection('knowledge-units').doc('k1').set({ type: 'Kanji', content: '川', data: { meaning: 'river' } });
      await expect(service.attach('p1', { kind: 'ku', kuId: 'k1' })).rejects.toThrow(/is a Kanji/);
      await expect(service.create({ subject: { kind: 'ku', kuId: 'k1' } })).rejects.toThrow(/is a Kanji/);
      expect(pictures().find(p => p.id === 'p1')).toMatchObject({ kuId: KU, usage: 'river' });
    });

    it('detaches a picture and re-attaches it to a usage', async () => {
      seed(vocabLesson([ex('time', 1), ex('cost', 2)]));
      existingPicture('p1', 'time', 'approved');
      const detached = await service.attach('p1', { kind: 'none' });
      expect(detached).toMatchObject({ kuId: null, usage: '', subject: { kind: 'none' }, status: 'approved', file: 'p1-1.png' });
      const back = await service.attach('p1', { kind: 'ku-usage', kuId: KU, usage: 'cost' });
      expect(back).toMatchObject({ kuId: KU, usage: 'cost', subject: { kind: 'ku-usage', kuId: KU, usage: 'cost' } });
      await expect(service.attach('p1', { kind: 'ku-usage', kuId: KU, usage: 'weight' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('re-runs the text check and records it', async () => {
      seed(vocabLesson([ex('time', 1)]));
      existingPicture('p1', 'time', 'approved');
      gemini.checkPictureForText.mockResolvedValue({ hasText: true, where: 'a clock face' });
      expect(await service.check('p1')).toEqual({ hasText: true, where: 'a clock face' });
      expect(pictures().find(p => p.id === 'p1')?.attempts).toEqual([{ hasText: true, where: 'a clock face' }]);
    });

    it('never offers whole-KU or free-standing pictures as distractors', async () => {
      db.collection('pictures').doc('a').set({ kuId: 'other', usage: '', subject: { kind: 'ku', kuId: 'other' }, status: 'approved', file: 'a.png' });
      db.collection('pictures').doc('b').set({ kuId: null, usage: '', subject: { kind: 'none' }, status: 'approved', file: 'b.png' });
      db.collection('pictures').doc('c').set({ kuId: 'third', usage: 'x', status: 'approved', file: 'c.png' });
      expect((await service.choices('u1', KU, 3)).map(c => c.id)).toEqual(['c']);
    });

    it('uploads a diagram for a whole Grammar KU', async () => {
      db.collection('knowledge-units').doc('g1').set({ type: 'Grammar', content: '〜てくれる', data: { title: 'Receiving a favour' } });
      const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('d')]);
      const p = await service.upload('g1', undefined, { buffer: PNG, mimetype: 'image/png', size: PNG.length }, 'ku');
      expect(p).toMatchObject({ kuId: 'g1', origin: 'uploaded', status: 'needs-review', subject: { kind: 'ku', kuId: 'g1' } });
      expect(fs.existsSync(path.join(dir, p.file!))).toBe(true);
    });
  });

  describe('usage states (Add a Picture)', () => {
    it('reports each usage as none, waiting or bound; rejected pictures do not count', async () => {
      seed(vocabLesson([ex('time', 1), ex('cost', 2), ex('hang', 3), ex('rest', 4)]));
      existingPicture('a', 'time', 'approved');
      existingPicture('w', 'cost', 'needs-review');
      existingPicture('u', 'hang', 'unpicturable', false);
      existingPicture('r', 'rest', 'rejected');
      const res = await service.usageStates(KU);
      expect(res.labelled).toBe(true);
      expect(res.usages.map(u => [u.usage, u.state, u.pictureIds, u.rejected])).toEqual([
        ['time', 'bound', ['a'], 0],
        ['cost', 'waiting', ['w'], 0],
        ['hang', 'waiting', ['u'], 0],
        ['rest', 'none', [], 1],
      ]);
      expect(res.usages[2].pictures).toEqual([{ id: 'u', status: 'unpicturable' }]);
      expect(res.usages[0].pictures).toEqual([{ id: 'a', status: 'approved', file: 'a-1.png' }]);
    });

    it('a picture still being drawn makes its usage waiting', async () => {
      seed(vocabLesson([ex('time', 1), ex('cost', 2)]));
      let release!: () => void;
      gemini.generatePictureBrief.mockImplementationOnce(() => new Promise(r => (release = () => r(okBrief))));
      await service.create({ subject: { kind: 'ku-usage', kuId: KU, usage: 'cost' } });
      const during = await service.usageStates(KU);
      expect(during.usages.map(u => [u.usage, u.state, u.drawing])).toEqual([['time', 'none', false], ['cost', 'waiting', true]]);
      await waitFor(() => !!release);
      release();
      await waitFor(() => service.getJob().rendering.length === 0);
      const after = await service.usageStates(KU);
      expect(after.usages[1]).toMatchObject({ state: 'waiting', drawing: false });
    });

    it('flags a word whose examples are not all labelled', async () => {
      seed(vocabLesson([ex('time', 1), ex(undefined, 2)], ['to take']));
      const res = await service.usageStates(KU);
      expect(res.labelled).toBe(false);
      expect(res.usages.map(u => u.usage)).toEqual(['to take']);
      expect(usagesLabelled(vocabLesson([]) as any)).toBe(false);
    });

    it('refuses non-Vocab KUs', async () => {
      seed(vocabLesson([ex('x')]), 'Grammar');
      await expect(service.usageStates(KU)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('unpicturable is the AI\'s call', () => {
    it('the admin cannot mark a picture unpicturable', async () => {
      seed(vocabLesson([ex('time', 1)]));
      existingPicture('p1', 'time', 'needs-review');
      await expect(service.setStatus('p1', 'unpicturable')).rejects.toBeInstanceOf(BadRequestException);
      expect(pictures().find(p => p.id === 'p1')?.status).toBe('needs-review');
    });

    it('a picture without an image cannot be approved', async () => {
      seed(vocabLesson([ex('time', 1)]));
      existingPicture('u1', 'time', 'unpicturable', false);
      await expect(service.setStatus('u1', 'approved')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

async function waitFor(cond: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 5));
  }
}
