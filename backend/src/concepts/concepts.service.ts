import { Injectable, Inject, Logger } from '@nestjs/common';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION, CONCEPTS_COLLECTION, USER_CONCEPTS_SUBCOLLECTION } from '../firebase/firebase.module';
import { GeminiService } from '../gemini/gemini.service';
import { ReviewsService } from '../reviews/reviews.service';
import { FacetStore } from '../facets/facet-store';
import { ConceptKnowledgeUnit, UserConcept, ReviewFacet } from '../types';
import { buildConceptPrompt } from '../prompts/concept.prompts';


export type UserConceptWithData = UserConcept & {
  concept: ConceptKnowledgeUnit & { id: string };
};

@Injectable()
export class ConceptsService {
  private readonly logger = new Logger(ConceptsService.name);

  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly geminiService: GeminiService,
    private readonly reviewsService: ReviewsService,
    private readonly facetStore: FacetStore,
  ) { }

  private userConceptsRef(uid: string) {
    return this.db.collection('users').doc(uid).collection(USER_CONCEPTS_SUBCOLLECTION);
  }

  async enroll(uid: string, conceptId: string): Promise<UserConceptWithData> {
    const existing = await this.userConceptsRef(uid)
      .where('conceptId', '==', conceptId)
      .limit(1)
      .get();

    const now = Timestamp.now();
    let docId: string;

    if (!existing.empty) {
      docId = existing.docs[0].id;
      await this.userConceptsRef(uid).doc(docId).update({ lastSeenAt: now });
      this.logger.log(`Updated lastSeenAt for uid=${uid} conceptId=${conceptId}`);
    } else {
      const payload: Omit<UserConcept, 'id'> = { userId: uid, conceptId, startedAt: now };
      const ref = await this.userConceptsRef(uid).add(payload);
      docId = ref.id;
      this.logger.log(`Enrolled uid=${uid} in conceptId=${conceptId} userConceptId=${docId}`);
    }

    const [ucDoc, conceptDoc] = await Promise.all([
      this.userConceptsRef(uid).doc(docId).get(),
      this.db.collection(CONCEPTS_COLLECTION).doc(conceptId).get(),
    ]);

    const userConcept = { id: ucDoc.id, ...ucDoc.data() } as UserConcept;
    const concept = { id: conceptDoc.id, ...conceptDoc.data() } as ConceptKnowledgeUnit & { id: string };
    return { ...userConcept, concept };
  }

  async findAllForUser(uid: string): Promise<UserConceptWithData[]> {
    const snapshot = await this.userConceptsRef(uid)
      .orderBy('startedAt', 'desc')
      .get();

    if (snapshot.empty) return [];

    const userConcepts = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as UserConcept));
    const conceptRefs = userConcepts.map(uc => this.db.collection(CONCEPTS_COLLECTION).doc(uc.conceptId));
    const conceptDocs = await this.db.getAll(...conceptRefs);

    const results: UserConceptWithData[] = [];
    for (let i = 0; i < userConcepts.length; i++) {
      const conceptDoc = conceptDocs[i];
      if (!conceptDoc.exists) {
        this.logger.warn(`Concept ${userConcepts[i].conceptId} not found for user-concept ${userConcepts[i].id}`);
        continue;
      }
      results.push({
        ...userConcepts[i],
        concept: { id: conceptDoc.id, ...conceptDoc.data() } as ConceptKnowledgeUnit & { id: string },
      });
    }
    return results;
  }

  async getFacets(uid: string, conceptId: string): Promise<ReviewFacet[]> {
    return this.facetStore.byKuId(uid, conceptId);
  }

  async createFacets(uid: string, conceptId: string, mechanicIndices: number[], includeAiQuestion = false): Promise<{ created: number }> {
    const conceptDoc = await this.db.collection(CONCEPTS_COLLECTION).doc(conceptId).get();
    if (!conceptDoc.exists) throw new Error(`Concept ${conceptId} not found`);

    const concept = { id: conceptDoc.id, ...conceptDoc.data() } as ConceptKnowledgeUnit & { id: string };

    const facets: Array<{ kuId: string; facetType: ReviewFacet['facetType']; data: any }> = [];

    for (const idx of mechanicIndices) {
      const mechanic = concept.data.mechanics[idx];
      if (!mechanic) {
        this.logger.warn(`Mechanic index ${idx} out of range for concept ${conceptId}`);
        continue;
      }
      facets.push({
        kuId: conceptId,
        facetType: 'sentence-assembly',
        data: {
          mechanicIndex: idx,
          goalTitle: mechanic.goalTitle,
          fragments: mechanic.naturalExample.fragments,
          answer: mechanic.naturalExample.japanese,
          english: mechanic.naturalExample.english,
          accepted_alternatives: mechanic.naturalExample.accepted_alternatives ?? [],
          sourceId: conceptId,
          sourceTitle: concept.data.title,
        },
      });
    }

    if (includeAiQuestion) {
      facets.push({
        kuId: conceptId,
        facetType: 'AI-Generated-Question',
        data: { topic: concept.data.title, sourceId: conceptId, sourceTitle: concept.data.title },
      });
    }

    const created = await this.reviewsService.createFacetBatch(uid, facets, { type: 'concept', id: conceptId });

    await this.userConceptsRef(uid)
      .where('conceptId', '==', conceptId)
      .limit(1)
      .get()
      .then(snap => {
        if (!snap.empty) snap.docs[0].ref.update({ facetCount: created });
      });

    this.logger.log(`Created ${created} facets for uid=${uid} conceptId=${conceptId}`);
    return { created };
  }

  async generate(uid: string, topic: string, notes?: string): Promise<ConceptKnowledgeUnit & { id: string }> {
    this.logger.log(`Generating concept for topic="${topic}" uid=${uid}`);

    const userDoc = await this.db.collection('users').doc(uid).get();
    const jlptLevel: string = (userDoc.data() as any)?.preferences?.jlptLevel ?? 'N5';

    const prompt = buildConceptPrompt(topic, jlptLevel, notes);
    this.logger.log(`Prompt length: ${prompt.length} chars`);

    const jsonString = await this.geminiService.generateConcept(prompt, { topic });
    this.logger.log(`Raw AI response length: ${jsonString.length} chars`);
    this.logger.log(`Raw AI response preview: ${jsonString.slice(0, 300)}`);

    let concept: ConceptKnowledgeUnit;
    try {
      concept = JSON.parse(jsonString) as ConceptKnowledgeUnit;
      this.logger.log(`Parsed concept — type=${concept.type} content="${concept.content}" title="${concept.data?.title}"`);
      this.logger.log(`Mechanics count: ${concept.data?.mechanics?.length ?? 'MISSING'}`);
      this.logger.log(`Examples count: ${concept.data?.examples?.length ?? 'MISSING'}`);
    } catch (e) {
      this.logger.error('Failed to parse AI JSON response for concept', { jsonString, e });
      throw new Error('Failed to parse AI JSON response for concept');
    }

    // Destructure id out so the Firestore document doesn't store a duplicate id field
    // and to avoid TS2783 (spread + explicit property collision on KnowledgeUnitBase.id).
    const { id: _id, ...conceptData } = concept;
    this.logger.log(`Writing to Firestore collection "${CONCEPTS_COLLECTION}"`);
    const docRef = await this.db.collection(CONCEPTS_COLLECTION).add({
      ...conceptData,
      createdBy: uid,
      createdAt: new Date(),
    });

    this.logger.log(`Saved concept ${docRef.id} for topic="${topic}"`);
    return { id: docRef.id, ...conceptData } as ConceptKnowledgeUnit & { id: string };
  }

  async findById(id: string): Promise<(ConceptKnowledgeUnit & { id: string }) | null> {
    this.logger.log(`findById: querying concepts/${id}`);
    const doc = await this.db.collection(CONCEPTS_COLLECTION).doc(id).get();
    this.logger.log(`findById: doc.exists=${doc.exists}`);
    if (!doc.exists) return null;
    const raw = doc.data();
    this.logger.log(`findById: raw keys=${Object.keys(raw ?? {}).join(', ')}`);
    this.logger.log(`findById: raw.type=${raw?.type} raw.data.title=${raw?.data?.title}`);
    return { id: doc.id, ...(raw as Omit<ConceptKnowledgeUnit, 'id'>) } as ConceptKnowledgeUnit & { id: string };
  }

  async findAll(): Promise<(ConceptKnowledgeUnit & { id: string })[]> {
    const snapshot = await this.db
      .collection(CONCEPTS_COLLECTION)
      .orderBy('createdAt', 'desc')
      .get();
    return snapshot.docs.map(
      doc => ({ id: doc.id, ...(doc.data() as Omit<ConceptKnowledgeUnit, 'id'>) }) as ConceptKnowledgeUnit & { id: string },
    );
  }
}
