/**
 * One-off: seed realistic leechVocab entries directly into Firestore for a
 * test account, since generating them organically via real reviews would
 * require failing the same facet 3x among hundreds of other due items.
 *
 * Uses the real StatsService.addToLeechVocab path (same write shape a genuine
 * 3x-failure would produce) and also bumps consecutiveFailures on the backing
 * review-facet so the data stays internally consistent.
 *
 * Run from backend/: npx ts-node -r tsconfig-paths/register scripts/seed-leeches.ts
 * Delete this file once the eval harness has what it needs — it's a one-off, not a maintained tool.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { StatsService } from '../src/stats/stats.service';
import { FIRESTORE_CONNECTION, KNOWLEDGE_UNITS_COLLECTION } from '../src/firebase/firebase.module';
import { FacetStore } from '../src/facets/facet-store';
import type { Firestore } from 'firebase-admin/firestore';

const TEST_UID = 'T6UtoM95CqVupa8zyIoSY6jR1L52';
const NUM_LEECHES = 3;

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const db = app.get<Firestore>(FIRESTORE_CONNECTION);
  const statsService = app.get(StatsService);
  const facetStore = app.get(FacetStore);

  const facetsSnap = await facetStore.query(TEST_UID).limit(50).get();

  if (facetsSnap.empty) {
    console.error('No review-facets found for this uid.');
    await app.close();
    return;
  }

  const candidates = facetsSnap.docs
    .map(d => ({ id: d.id, ...(d.data() as any) }))
    .filter(f => f.kuId && f.facetType)
    .slice(0, NUM_LEECHES);

  for (const facet of candidates) {
    const kuDoc = await db.collection(KNOWLEDGE_UNITS_COLLECTION).doc(facet.kuId).get();
    const content = kuDoc.data()?.content;
    if (!content) {
      console.log(`  skip facet ${facet.id} — KU ${facet.kuId} has no content`);
      continue;
    }

    await statsService.addToLeechVocab(TEST_UID, content, facet.facetType);

    await facetStore.doc(TEST_UID, facet.id).update({ consecutiveFailures: 3 });

    console.log(`  seeded leech: "${content}" (${facet.facetType}) via facet ${facet.id}`);
  }

  console.log(`\nDone. Seeded ${candidates.length} leech entries for uid=${TEST_UID}.`);
  await app.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
