import { Injectable, Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION, KNOWLEDGE_UNITS_COLLECTION, PICTURES_COLLECTION, USER_KUS_SUBCOLLECTION } from '../firebase/firebase.module';
import { FacetStore } from '../facets/facet-store';
import { UserService } from '../users/user.service';
import { isUsagePicture } from '../pictures/pictures.service';

/** Start Learning serves at most this many waiting items per session; the rest come next time. */
const WAITING_PER_SESSION = 10;

/** One item Start Learning offers. */
export type QueueItem = { kuId: string; content: string; type: string };

const toItem = (d: FirebaseFirestore.DocumentSnapshot): QueueItem =>
  ({ kuId: d.id, content: d.data()?.content as string, type: d.data()?.type as string });

const millis = (t: any) => (typeof t?.toMillis === 'function' ? t.toMillis() : (t?.seconds ?? t?._seconds ?? 0) * 1000);

/**
 * Decides what Start Learning teaches next: the user's waiting items first, otherwise a mix of
 * new corpus items at their level. A learning-progress concern, so it lives here rather than in
 * the lesson-generation service.
 */
@Injectable()
export class LearningQueueService {
  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly facetStore: FacetStore,
    private readonly userService: UserService,
  ) {}

  async getQueue(uid: string): Promise<QueueItem[]> {
    // The user's facets and UKUs are read once and shared by both paths.
    const [started, ukus] = await Promise.all([
      this.startedKuIds(uid),
      this.db.collection('users').doc(uid).collection(USER_KUS_SUBCOLLECTION).get().then(s => s.docs.map(d => d.data())),
    ]);

    // Start Learning services the user's own queue first: everything already waiting
    // (status 'learning' — the "Available lessons" count), and only that. New corpus
    // items are added only when nothing is waiting.
    const waiting = await this.getWaitingLessons(ukus, started);
    if (waiting.length > 0) return waiting;

    const prefs = await this.userService.getPreferences(uid);
    const jlptLevel = prefs.jlptLevel;

    // Anything the user has started or has a UKU for is never offered as new. A UKU with no
    // facets that isn't 'learning' is a stale record (e.g. its facets were deleted by hand),
    // not a lesson to serve.
    const ukuKuIds = ukus.map(u => u.kuId as string).filter(Boolean);
    const seenKuIds = new Set([...started, ...ukuKuIds]);

    // ── Path 1a: Vocab / Kanji corpus ─────────────────────────────────────
    // ── Path 1b: Grammar corpus ────────────────────────────────────────────
    // Run separately so Grammar always gets guaranteed slots regardless of
    // how many Vocab/Kanji items exist at the same JLPT level.
    const [vocabKanjiSnap, grammarCorpusSnap] = await Promise.all([
      this.db.collection(KNOWLEDGE_UNITS_COLLECTION)
        .where('data.jlptLevel', '==', jlptLevel)
        .where('type', 'in', ['Vocab', 'Kanji'])
        .limit(200)
        .get(),
      this.db.collection(KNOWLEDGE_UNITS_COLLECTION)
        .where('data.jlptLevel', '==', jlptLevel)
        .where('type', '==', 'Grammar')
        .limit(50)
        .get(),
    ]);

    // Audio-first experiment: Vocab at the user's level that has approved pictures comes
    // first, so the experiment's words actually reach the learner. Fetched directly — the
    // corpus query above only samples the first 200 at the level.
    let picturedDocs: FirebaseFirestore.DocumentSnapshot[] = [];
    if (prefs.audioFirstExperiment === true) {
      const pics = await this.db.collection(PICTURES_COLLECTION).where('status', '==', 'approved').select('kuId', 'subject').get();
      // Usage pictures only: free-standing ones have kuId null, and whole-KU ones aren't cards.
      const ids = [...new Set(pics.docs.filter(d => isUsagePicture(d.data())).map(d => d.data().kuId as string))].filter(id => !seenKuIds.has(id));
      if (ids.length) {
        const kuCol = this.db.collection(KNOWLEDGE_UNITS_COLLECTION);
        picturedDocs = (await this.db.getAll(...ids.map(id => kuCol.doc(id))))
          .filter(d => d.exists && d.data()?.type === 'Vocab' && d.data()?.data?.jlptLevel === jlptLevel);
      }
    }
    const pictured = new Set(picturedDocs.map(d => d.id));
    const vocabKanjiItems = [...picturedDocs, ...vocabKanjiSnap.docs.filter(d => !pictured.has(d.id))]
      .filter(d => !seenKuIds.has(d.id))
      .slice(0, 7)
      .map(toItem);

    const grammarCorpusItems = grammarCorpusSnap.docs
      .filter(d => !seenKuIds.has(d.id))
      .slice(0, 3)
      .map(toItem);

    return [...grammarCorpusItems, ...vocabKanjiItems];
  }

  /**
   * KU ids the user has started, i.e. that have at least one facet. A facet counts for two KUs:
   * the word whose sequence it belongs to (source.id) and the content it targets (kuId). These
   * differ for Kanji-Component-* facets, which target the component kanji's own kuId while being
   * gated by the parent Vocab word's source.id (see ReviewProgressService.getFacetsAtStage).
   * Counting only one leaves the other looking unstarted, so it would be offered again.
   */
  private async startedKuIds(uid: string): Promise<Set<string>> {
    const started = new Set<string>();
    (await this.facetStore.query(uid).select('kuId', 'source').get()).docs.forEach(d => {
      const f = d.data();
      if (f.kuId) started.add(f.kuId as string);
      if (f.source?.id) started.add(f.source.id as string);
    });
    return started;
  }

  /**
   * The user's KUs waiting for a lesson, oldest enrolment first, at most WAITING_PER_SESSION.
   * Waiting = UKU status 'learning' AND not started (see startedKuIds). The status is a cache:
   * a stale 'learning' on a word that already has facets (e.g. written before kanji-component
   * facets counted toward their word) would otherwise be served every session, since
   * enrollment skips a word that's already started. Deleted KUs are skipped.
   */
  private async getWaitingLessons(ukus: FirebaseFirestore.DocumentData[], started: Set<string>): Promise<QueueItem[]> {
    const candidates = ukus
      .filter(u => u.status === 'learning' && u.kuId && !started.has(u.kuId as string))
      .sort((a, b) => millis(a.createdAt) - millis(b.createdAt));

    // Read in chunks until enough live KUs are found: a run of UKUs whose KU was deleted
    // must not hide newer waiting words.
    const kuCol = this.db.collection(KNOWLEDGE_UNITS_COLLECTION);
    const found: QueueItem[] = [];
    for (let i = 0; i < candidates.length && found.length < WAITING_PER_SESSION; i += 50) {
      const chunk = candidates.slice(i, i + 50);
      const kuDocs = await this.db.getAll(...chunk.map(u => kuCol.doc(u.kuId as string)));
      found.push(...kuDocs.filter(d => d.exists).map(toItem));
    }
    return found.slice(0, WAITING_PER_SESSION);
  }
}
