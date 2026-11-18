import { ReviewFacet } from '../types';

/** A card needs this many reviews before it gets a failRate (and can appear in "Hardest items"). */
export const FAIL_RATE_MIN_REVIEWS = 5;

/**
 * The card's review and fail counts after one more answer, for the "Hardest items" widget.
 * A card counted before (reviewCount set) adds to its counts; an older card is seeded from its history
 * first, so its past reviews count. failRate is only set from FAIL_RATE_MIN_REVIEWS reviews.
 */
export function nextFailCounts(
    facet: Pick<ReviewFacet, 'reviewCount' | 'failCount' | 'history'>,
    failed: boolean,
): { reviewCount: number; failCount: number; failRate?: number } {
    const seeded = facet.reviewCount !== undefined;
    const reviews = (seeded ? facet.reviewCount! : facet.history?.length ?? 0) + 1;
    const fails = (seeded ? facet.failCount ?? 0 : (facet.history ?? []).filter(h => h.result === 'fail').length) + (failed ? 1 : 0);
    return {
        reviewCount: reviews,
        failCount: fails,
        ...(reviews >= FAIL_RATE_MIN_REVIEWS ? { failRate: fails / reviews } : {}),
    };
}
