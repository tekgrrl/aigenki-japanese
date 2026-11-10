import { Injectable, Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION, KNOWLEDGE_UNITS_COLLECTION, PICTURES_COLLECTION, USER_KUS_SUBCOLLECTION } from '../firebase/firebase.module';
import { FacetStore } from '../facets/facet-store';
import { UserService } from '../users/user.service';
import { isUsagePicture } from '../pictures/pictures.service';

/** Start Learning serves at most this many waiting items per session; the rest come next time. */
const WAITING_PER_SESSION = 10;

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

  async getQueue(uid: string): Promise<{ kuId: string; content: string; type: string }[]> {
    // Start Learning services the user's own queue first: everything already waiting
    // (status 'learning' — the "Available lessons" count), and only that. New corpus
    // items are added only when nothing is waiting.
    const waiting = await this.getWaitingLessons(uid);
    if (waiting.length > 0) return waiting;

    const prefs = await this.userService.getPreferences(uid);
    const jlptLevel = prefs.jlptLevel;

    const facetsCol = this.facetStore.query(uid);

    const [facetsSnap, ukuSnap] = await Promise.all([
      facetsCol.get(),
      this.db.collection('users').doc(uid).collection(USER_KUS_SUBCOLLECTION).get(),
    ]);

    // Separate facet KU ids from UKU KU ids so we can compute enrolled-but-not-started.
    // A facet can be "started" for two different KUs at once: the word whose sequence
    // it belongs to (source.id) and the specific content it targets (kuId) — these
    // differ for Kanji-Component-* facets, which target the component kanji's own kuId
    // while being gated by the parent Vocab word's source.id (see
    // ReviewProgressService.getFacetsAtStage). Registering only one of the two
    // incorrectly leaves the other looking "enrolled but never started" forever —
    // track both so neither the parent word nor the component kanji gets stuck.
    const facetKuIds = new Set<string>();
    facetsSnap.docs.forEach(d => {
      const data = d.data();
      if (data.kuId) facetKuIds.add(data.kuId as string);
      if (data.source?.id) facetKuIds.add(data.source.id as string);
    });
    const ukuKuIds = ukuSnap.docs.map(d => d.data().kuId as string).filter(Boolean);
    const seenKuIds = new Set([...facetKuIds, ...ukuKuIds]);

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
      .map(d => ({ kuId: d.id, content: d.data()?.content as string, type: d.data()?.type as string }));

    const grammarCorpusItems = grammarCorpusSnap.docs
      .filter(d => !seenKuIds.has(d.id))
      .slice(0, 3)
      .map(d => ({ kuId: d.id, content: d.data().content as string, type: d.data().type as string }));

    // ── Path 2: Enrolled-but-not-started queue ────────────────────────────
    // KUs the user enrolled (via a scenario, or the "help me learn this" flag
    // flow) but hasn't started in review yet (UKU exists, no facets). Covers
    // all types, not just Grammar — a flagged Vocab word with zero facets
    // would otherwise never surface here at all (seenKuIds already excludes
    // it from the fresh-corpus pool below).
    const enrolledNotStarted = ukuKuIds.filter(id => !facetKuIds.has(id));

    let enrolledGrammarItems: { kuId: string; content: string; type: string }[] = [];
    let enrolledVocabKanjiItems: { kuId: string; content: string; type: string }[] = [];
    if (enrolledNotStarted.length > 0) {
      const chunk = enrolledNotStarted.slice(0, 30);
      const enrolledSnap = await this.db.collection(KNOWLEDGE_UNITS_COLLECTION)
        .where('__name__', 'in', chunk)
        .get();
      enrolledGrammarItems = enrolledSnap.docs
        .filter(d => d.data().type === 'Grammar')
        .slice(0, 3)
        .map(d => ({ kuId: d.id, content: d.data().content as string, type: d.data().type as string }));
      enrolledVocabKanjiItems = enrolledSnap.docs
        .filter(d => d.data().type === 'Vocab' || d.data().type === 'Kanji')
        .slice(0, 3)
        .map(d => ({ kuId: d.id, content: d.data().content as string, type: d.data().type as string }));
    }

    // Enrolled grammar first, then corpus grammar, then enrolled vocab/kanji, then corpus vocab/kanji
    const grammarItems = [
      ...enrolledGrammarItems,
      ...grammarCorpusItems.filter(g => !enrolledGrammarItems.some(e => e.kuId === g.kuId)),
    ].slice(0, 3);

    const combinedVocabKanjiItems = [
      ...enrolledVocabKanjiItems,
      ...vocabKanjiItems.filter(v => !enrolledVocabKanjiItems.some(e => e.kuId === v.kuId)),
    ].slice(0, 7);

    return [...grammarItems, ...combinedVocabKanjiItems].slice(0, 10);
  }

  /**
   * The user's KUs waiting for a lesson, oldest enrolment first, at most WAITING_PER_SESSION.
   * Waiting = UKU status 'learning' AND no facets yet (by kuId or source.id, as in Path 2
   * below). The status is a cache: a stale 'learning' on a word that already has facets
   * (e.g. written before kanji-component facets counted toward their word) would otherwise
   * be served every session, since enrollment skips a word that's already started.
   * Deleted KUs are skipped.
   */
  private async getWaitingLessons(uid: string): Promise<{ kuId: string; content: string; type: string }[]> {
    const ukuSnap = await this.db.collection('users').doc(uid).collection(USER_KUS_SUBCOLLECTION)
      .where('status', '==', 'learning')
      .get();
    if (ukuSnap.empty) return [];

    const facetsCol = this.facetStore.query(uid);
    const started = new Set<string>();
    (await facetsCol.select('kuId', 'source').get()).docs.forEach(d => {
      const f = d.data();
      if (f.kuId) started.add(f.kuId as string);
      if (f.source?.id) started.add(f.source.id as string);
    });

    const millis = (t: any) => (typeof t?.toMillis === 'function' ? t.toMillis() : (t?.seconds ?? t?._seconds ?? 0) * 1000);
    const candidates = ukuSnap.docs.map(d => d.data())
      .filter(u => u.kuId && !started.has(u.kuId as string))
      .sort((a, b) => millis(a.createdAt) - millis(b.createdAt));

    // Read in chunks until enough live KUs are found: a run of UKUs whose KU was deleted
    // must not hide newer waiting words.
    const kuCol = this.db.collection(KNOWLEDGE_UNITS_COLLECTION);
    const found: { kuId: string; content: string; type: string }[] = [];
    for (let i = 0; i < candidates.length && found.length < WAITING_PER_SESSION; i += 50) {
      const chunk = candidates.slice(i, i + 50);
      const kuDocs = await this.db.getAll(...chunk.map(u => kuCol.doc(u.kuId as string)));
      for (const d of kuDocs) {
        if (d.exists) found.push({ kuId: d.id, content: d.data()!.content as string, type: d.data()!.type as string });
      }
    }
    return found.slice(0, WAITING_PER_SESSION);
  }
}
