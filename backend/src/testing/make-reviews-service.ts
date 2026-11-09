import { ReviewsService } from '../reviews/reviews.service';
import { FacetStore } from '../facets/facet-store';
import { FakeFirestore } from './fake-firestore';

type Deps = {
  gemini: unknown;
  questions: unknown;
  stats: unknown;
  kanji: unknown;
  scenarioFlash: unknown;
  reviewOutcome: unknown;
};

/**
 * ReviewsService for specs, with collaborators by name rather than by position. Anything not given
 * is `fallback` (default: an empty object, so a call to it fails loudly).
 */
export function makeReviewsService(db: FakeFirestore, deps: Partial<Deps> = {}, fallback: unknown = {}): ReviewsService {
  const d = (k: keyof Deps) => (deps[k] ?? fallback) as any;
  return new ReviewsService(db as any, new FacetStore(db as any), d('gemini'), d('questions'), d('stats'), d('kanji'), d('scenarioFlash'), d('reviewOutcome'));
}
