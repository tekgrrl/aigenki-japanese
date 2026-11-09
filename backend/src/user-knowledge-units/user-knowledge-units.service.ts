import { Injectable, Inject, Logger } from '@nestjs/common';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION, KNOWLEDGE_UNITS_COLLECTION, USER_KUS_SUBCOLLECTION } from '../firebase/firebase.module';
import { KnowledgeUnit, UserKnowledgeUnit } from '../types';
import { StatsService } from '../stats/stats.service';
import { isAboveLevel } from '../lib/jlpt';
import { UserService } from '../users/user.service';
import { KnowledgeUnitsService } from '../knowledge-units/knowledge-units.service';
import { enrolledKuId } from './enrolled-ku-id';

@Injectable()
export class UserKnowledgeUnitsService {
  private readonly logger = new Logger(UserKnowledgeUnitsService.name);

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly statsService: StatsService,
    private readonly userService: UserService,
    private readonly knowledgeUnitsService: KnowledgeUnitsService,
  ) {}

  private userKusRef(uid: string) {
    return this.db.collection('users').doc(uid).collection(USER_KUS_SUBCOLLECTION);
  }

  async findByKuId(uid: string, kuId: string): Promise<UserKnowledgeUnit | null> {
    const snapshot = await this.userKusRef(uid)
      .where('kuId', '==', kuId)
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() } as UserKnowledgeUnit;
  }

  private async _joinKUs(uid: string, snapshot: FirebaseFirestore.QuerySnapshot): Promise<KnowledgeUnit[]> {
    if (snapshot.empty) return [];

    const ukus = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserKnowledgeUnit));

    const kuRefs = ukus.map(uku => this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(uku.kuId));
    const kuDocs = await this.db.getAll(...kuRefs);

    const result: KnowledgeUnit[] = [];
    for (let i = 0; i < ukus.length; i++) {
      const uku = ukus[i];
      const kuDoc = kuDocs[i];
      if (!kuDoc.exists) {
        this.logger.warn(`Global KU ${uku.kuId} not found for UKU ${uku.id}`);
        continue;
      }
      const kuData = kuDoc.data()!;
      result.push({
        id: kuDoc.id,
        ...kuData,
        createdAt: typeof kuData.createdAt?.toDate === 'function'
                ? kuData.createdAt.toDate().toISOString()
                : kuData.createdAt,
        // UKU state fields — projected onto the KU shape for the client
        ukuStatus: uku.status,
        ukuFacetCount: uku.facet_count,
      } as unknown as KnowledgeUnit);
    }

    return result;
  }

  async findAllAsKUs(uid: string): Promise<KnowledgeUnit[]> {
    const snapshot = await this.userKusRef(uid).get();
    return this._joinKUs(uid, snapshot);
  }

  async findLearningQueueAsKUs(uid: string): Promise<KnowledgeUnit[]> {
    const snapshot = await this.userKusRef(uid)
      .where('status', '==', 'learning')
      .get();
    return this._joinKUs(uid, snapshot);
  }

  async remove(uid: string, kuId: string): Promise<void> {
    const uku = await this.findByKuId(uid, kuId);
    if (!uku) return;
    await this.userKusRef(uid).doc(uku.id).delete();
    this.logger.log(`Removed UKU ${uku.id} for uid=${uid} kuId=${kuId}`);
  }

  async update(uid: string, kuId: string, data: Record<string, any>): Promise<void> {
    const uku = await this.findByKuId(uid, kuId);
    if (!uku) {
      this.logger.warn(`update: no UKU found for uid=${uid} kuId=${kuId}`);
      return;
    }
    await this.userKusRef(uid).doc(uku.id).update(data);
    this.logger.log(`Updated UKU ${uku.id} for uid=${uid} kuId=${kuId}`);
  }

  async create(
    uid: string,
    kuId: string,
    source?: UserKnowledgeUnit['source'],
  ): Promise<UserKnowledgeUnit> {
    const existing = await this.findByKuId(uid, kuId);
    if (existing) {
      this.logger.log(`UKU already exists for uid=${uid} kuId=${kuId}`);
      if (source && !existing.source) {
        await this.userKusRef(uid).doc(existing.id).update({ source });
        this.logger.log(`Backfilled source on existing UKU ${existing.id}`);
        return { ...existing, source };
      }
      return existing;
    }

    const now = Timestamp.now();
    const payload: Omit<UserKnowledgeUnit, 'id'> = {
      userId: uid,
      kuId,
      createdAt: now,
      status: 'learning',
      facet_count: 0,
      ...(source ? { source } : {}),
    };

    const ref = await this.userKusRef(uid).add(payload);
    this.logger.log(`Created UKU id=${ref.id} for uid=${uid} kuId=${kuId} source=${source?.type ?? 'none'}`);

    // Non-blocking: update stats, tutorContext, and aboveLevel flag on enrollment
    void (async () => {
      try {
        const [kuDoc, userPrefs] = await Promise.all([
          this.db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(kuId).get(),
          this.userService.getPreferences(uid),
        ]);
        const kuData = kuDoc.data();
        const jlptLevel = kuData?.data?.jlptLevel;

        const aboveLevel = isAboveLevel(jlptLevel, userPrefs?.jlptLevel);
        await this.userKusRef(uid).doc(ref.id).update({ aboveLevel });

        if (jlptLevel && !aboveLevel) {
          await this.statsService.recordKuEnrolled(uid, jlptLevel);
          await this.statsService.updateCurriculumNode(uid, jlptLevel);
        }
        if (kuData?.type === 'Grammar' && kuData?.content && !aboveLevel) {
          await this.statsService.addToAllowedGrammar(uid, kuData.content, kuId);
        }
      } catch (e) {
        this.logger.error(`Failed to record KU enrolled stats uid=${uid} kuId=${kuId}`, e);
      }
    })();

    return { id: ref.id, ...payload };
  }

  /**
   * After the learner's level changes: re-derives `aboveLevel` on every enrolment from its KU's
   * level (also fills it on older enrolments that never had it). Returns how many flags changed.
   */
  async recomputeAboveLevel(uid: string, userLevel: string): Promise<number> {
    const ukus = (await this.userKusRef(uid).get()).docs;
    const kus = new Map((await this.knowledgeUnitsService.getManyCached(ukus.map(enrolledKuId))).map(k => [k.id, k]));
    const changes = ukus
      .map(d => ({ ref: d.ref, current: d.data().aboveLevel, next: isAboveLevel((kus.get(enrolledKuId(d))?.data as Record<string, any> | undefined)?.jlptLevel, userLevel) }))
      .filter(c => c.current !== c.next);
    for (let i = 0; i < changes.length; i += 450) {
      const batch = this.db.batch();
      changes.slice(i, i + 450).forEach(c => batch.update(c.ref, { aboveLevel: c.next }));
      await batch.commit();
    }
    this.logger.log(`recomputeAboveLevel uid=${uid} level=${userLevel}: ${changes.length} of ${ukus.length} enrolments changed`);
    return changes.length;
  }
}
