/**
 * Cleans up legacy Vocab KUs that predate the WaniKani import.
 *
 * Phase 1 (always runs): Report dupes — legacy KUs whose content matches a WaniKani KU.
 * Phase 2 (--delete): Delete the legacy dupe KUs and their lesson documents.
 * Phase 3 (--classify): For remaining legacy KUs with no JLPT level, call Gemini to classify them.
 *
 * Usage (from /backend directory):
 *   node scripts/cleanup-legacy-kus.mjs <path-to-service-account.json>
 *   node scripts/cleanup-legacy-kus.mjs <path-to-service-account.json> --delete
 *   node scripts/cleanup-legacy-kus.mjs <path-to-service-account.json> --delete --classify
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const [serviceAccountPath, ...flags] = process.argv.slice(2);

if (!serviceAccountPath) {
  console.error('Usage: node scripts/cleanup-legacy-kus.mjs <path-to-service-account.json> [--delete] [--classify]');
  process.exit(1);
}

const doDelete = flags.includes('--delete');
const doClassify = flags.includes('--classify');

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const FIRESTORE_DB = process.env.FIRESTORE_DB ?? 'aisrs-japanese-dev';
const db = getFirestore(FIRESTORE_DB);

const KNOWLEDGE_UNITS = 'knowledge-units';
const LESSONS = 'lessons';

// ─── Fetch all Vocab KUs ──────────────────────────────────────────────────────

console.log('Fetching all Vocab KUs...');
const snap = await db.collection(KNOWLEDGE_UNITS).where('type', '==', 'Vocab').get();
console.log(`Found ${snap.size} Vocab KUs total.\n`);

const wanikaniKus = [];  // { id, content, wanikaniLevel, jlptLevel }
const legacyKus = [];    // { id, content, jlptLevel }

for (const doc of snap.docs) {
  const d = doc.data();
  const content = d.content;
  const wanikaniLevel = d.data?.wanikaniLevel;
  const jlptLevel = d.data?.jlptLevel ?? null;

  if (wanikaniLevel != null) {
    wanikaniKus.push({ id: doc.id, content, wanikaniLevel, jlptLevel });
  } else {
    legacyKus.push({ id: doc.id, content, jlptLevel });
  }
}

console.log(`WaniKani KUs : ${wanikaniKus.length}`);
console.log(`Legacy KUs   : ${legacyKus.length}\n`);

// ─── Phase 1: Identify dupes ──────────────────────────────────────────────────

const wanikaniByContent = new Map(wanikaniKus.map(k => [k.content, k]));

const dupes = [];       // legacy KUs that have a WaniKani equivalent
const noMatch = [];     // legacy KUs with no WaniKani equivalent

for (const legacy of legacyKus) {
  if (wanikaniByContent.has(legacy.content)) {
    dupes.push({ legacy, wk: wanikaniByContent.get(legacy.content) });
  } else {
    noMatch.push(legacy);
  }
}

console.log(`── Dupes (legacy KU matches a WaniKani KU): ${dupes.length}`);
for (const { legacy, wk } of dupes.slice(0, 20)) {
  console.log(`  "${legacy.content}"  legacy=${legacy.id}  wk=${wk.id} (WK level ${wk.wanikaniLevel})`);
}
if (dupes.length > 20) console.log(`  ... and ${dupes.length - 20} more`);

console.log(`\n── Legacy KUs with no WaniKani match: ${noMatch.length}`);
const noJlpt = noMatch.filter(k => !k.jlptLevel);
const hasJlpt = noMatch.filter(k => k.jlptLevel);
console.log(`  With JLPT level    : ${hasJlpt.length}`);
console.log(`  Without JLPT level : ${noJlpt.length}`);
if (noJlpt.length > 0) {
  console.log('  Sample without JLPT:');
  for (const k of noJlpt.slice(0, 10)) {
    console.log(`    "${k.content}"  id=${k.id}`);
  }
  if (noJlpt.length > 10) console.log(`    ... and ${noJlpt.length - 10} more`);
}

// ─── Check for UKU / facet references to legacy dupe IDs ──────────────────────

if (dupes.length > 0) {
  console.log('\n── Checking for user references to legacy dupe KU IDs...');
  const legacyIds = new Set(dupes.map(d => d.legacy.id));

  const usersSnap = await db.collection('users').get();
  const affected = [];

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const [ukuSnap, facetsSnap] = await Promise.all([
      db.collection('users').doc(uid).collection('user-kus').get(),
      db.collection('users').doc(uid).collection('review-facets').get(),
    ]);

    const orphanUkus = ukuSnap.docs.filter(d => legacyIds.has(d.data().kuId));
    const orphanFacets = facetsSnap.docs.filter(d => legacyIds.has(d.data().kuId));

    if (orphanUkus.length > 0 || orphanFacets.length > 0) {
      affected.push({ uid, orphanUkus: orphanUkus.length, orphanFacets: orphanFacets.length });
    }
  }

  if (affected.length === 0) {
    console.log('  No user references found — safe to delete.');
  } else {
    console.log('  WARNING: the following users have records pointing to legacy KU IDs:');
    for (const a of affected) {
      console.log(`    uid=${a.uid}  UKUs=${a.orphanUkus}  facets=${a.orphanFacets}`);
    }
    console.log('  These orphaned records will NOT be deleted automatically.');
    console.log('  Review them manually or extend this script if needed.');
  }
}

// ─── Phase 2: Delete ──────────────────────────────────────────────────────────

if (doDelete && dupes.length > 0) {
  console.log(`\n── Deleting ${dupes.length} legacy dupe KUs and their lesson documents...`);
  const writer = db.bulkWriter();
  let deleted = 0;

  for (const { legacy } of dupes) {
    writer.delete(db.collection(KNOWLEDGE_UNITS).doc(legacy.id));
    writer.delete(db.collection(LESSONS).doc(legacy.id));
    deleted++;
  }

  await writer.close();
  console.log(`  Deleted ${deleted} KUs (and attempted to delete their lesson docs).`);
} else if (!doDelete && dupes.length > 0) {
  console.log('\nRun with --delete to remove the legacy dupe KUs.');
}

// ─── Phase 3: Classify remaining legacy KUs without JLPT level ───────────────

if (doClassify && noJlpt.length > 0) {
  console.log(`\n── Classifying ${noJlpt.length} legacy KUs without JLPT level via Gemini...`);

  // Load Gemini config from environment (same as NestJS app)
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('  GEMINI_API_KEY env var not set — skipping classify phase.');
  } else {
    const BATCH_SIZE = 50;
    const writer = db.bulkWriter();
    let classified = 0;

    for (let i = 0; i < noJlpt.length; i += BATCH_SIZE) {
      const batch = noJlpt.slice(i, i + BATCH_SIZE);
      const wordList = batch.map(k => k.content).join('\n');

      const prompt = `You are a Japanese JLPT classification expert. For each word below, output ONLY a JSON array where each element is {"content": "<word>", "jlpt": "<N5|N4|N3|N2|N1|null>"} using null if the word is not in any JLPT list. Output the JSON array only, no prose.\n\nWords:\n${wordList}`;

      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        const json = await res.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (!text) {
          console.error('  Empty response from Gemini:', JSON.stringify(json).slice(0, 300));
          continue;
        }
        const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
        let results;
        try {
          results = JSON.parse(cleaned);
        } catch (parseErr) {
          console.error('  JSON parse failed. Raw text:', cleaned.slice(0, 500));
          continue;
        }

        for (const { content, jlpt } of results) {
          const ku = batch.find(k => k.content === content);
          if (ku && jlpt) {
            writer.update(db.collection(KNOWLEDGE_UNITS).doc(ku.id), { 'data.jlptLevel': jlpt });
            classified++;
            console.log(`  "${content}" → ${jlpt}`);
          } else if (ku && !jlpt) {
            console.log(`  "${content}" → not in JLPT list (leaving unset)`);
          }
        }
      } catch (err) {
        console.error(`  Batch ${i / BATCH_SIZE + 1} failed:`, err.message);
      }
    }

    await writer.close();
    console.log(`  Updated JLPT level for ${classified} KUs.`);
  }
} else if (!doClassify && noJlpt.length > 0) {
  console.log('\nRun with --classify to assign JLPT levels to the remaining legacy KUs (requires GEMINI_API_KEY env var).');
}

console.log('\nDone.');
