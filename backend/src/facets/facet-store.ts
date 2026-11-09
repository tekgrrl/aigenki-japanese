import { Inject, Injectable, Logger } from '@nestjs/common';
import { CollectionReference, DocumentReference, Firestore, Query } from 'firebase-admin/firestore';
import { FIRESTORE_CONNECTION, REVIEW_FACETS_COLLECTION } from '../firebase/firebase.module';
import { ADMIN_USER_ID } from '../lib/constants';
import { ReviewFacet } from '../types';

/**
 * The one place that knows where a user's review facets live. The admin user (`user_default`)
 * keeps its facets in the top-level `review-facets` collection, shared with old data and
 * tagged with `userId`; everyone else has `users/{uid}/review-facets`. Every reader and
 * writer of facets goes through here, so that rule is written once.
 *
 * - Reading several facets: `query(uid)` (or `byKuId`), then add your own `where`s.
 * - Reading one facet: `get(uid, id)`.
 * - Writing: `doc(uid, id)` for an existing facet, `newDoc(uid)` for a new one, with
 *   `ownerTag(uid)` spread into the new facet's data.
 */
@Injectable()
export class FacetStore {
  private readonly logger = new Logger(FacetStore.name);

  constructor(@Inject(FIRESTORE_CONNECTION) private readonly db: Firestore) {}

  /**
   * The collection a user's facets live in. Private: for the admin it holds other users'
   * facets too, so reads go through `query()` and writes through `doc()` / `newDoc()`.
   */
  private col(uid: string): CollectionReference {
    return uid === ADMIN_USER_ID
      ? this.db.collection(REVIEW_FACETS_COLLECTION)
      : this.db.collection('users').doc(uid).collection(REVIEW_FACETS_COLLECTION);
  }

  /** All of a user's facets, and only theirs: the starting point for every read of several facets. */
  query(uid: string): Query {
    const col = this.col(uid);
    return uid === ADMIN_USER_ID ? col.where('userId', '==', uid) : col;
  }

  /**
   * A ref to one existing facet, for writes: `ref.update(...)`, `batch.update(ref, ...)`, or a
   * transaction (`tx.get(ref)` then `tx.update(ref, ...)`; check `belongsTo` on what you read).
   * For a plain read use `get()`, which does the ownership check for you.
   */
  doc(uid: string, facetId: string): DocumentReference {
    return this.col(uid).doc(facetId);
  }

  /** A ref with a new auto id, for creating a facet (`ref.set(...)` or `batch.set(ref, ...)`). */
  newDoc(uid: string): DocumentReference {
    return this.col(uid).doc();
  }

  /**
   * The fields a new facet needs to mark its owner: `{ userId }` in the admin's shared
   * collection, nothing elsewhere. Spread it into the facet data: `{ ...facetStore.ownerTag(uid) }`.
   */
  ownerTag(uid: string): { userId?: string } {
    return uid === ADMIN_USER_ID ? { userId: uid } : {};
  }

  /**
   * Whether facet data read through `doc()` belongs to `uid`. Only matters in the admin's shared
   * collection, where a facet must carry its `userId`; elsewhere the path proves it.
   */
  belongsTo(uid: string, data: { userId?: string } | undefined): boolean {
    return uid !== ADMIN_USER_ID || data?.userId === uid;
  }

  /** One of the user's facets, with its id, or null if it's gone or isn't theirs. */
  async get(uid: string, facetId: string): Promise<ReviewFacet | null> {
    const snap = await this.doc(uid, facetId).get();
    if (!snap.exists || !this.belongsTo(uid, snap.data())) return null;
    return { id: snap.id, ...snap.data() } as ReviewFacet;
  }

  /** The user's facets that test this KU (`kuId`; for kanji-component facets that's the kanji). */
  async byKuId(uid: string, kuId: string): Promise<ReviewFacet[]> {
    const snap = await this.query(uid).where('kuId', '==', kuId).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as ReviewFacet));
  }

  /** Points the facet at the AI question it should show (reused on its next review). */
  async updateQuestion(uid: string, facetId: string, questionId: string): Promise<void> {
    await this.doc(uid, facetId).update({ currentQuestionId: questionId });
    this.logger.log(`Updated facet ${facetId} with new question ${questionId}`);
  }
}
