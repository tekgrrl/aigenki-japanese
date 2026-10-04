/**
 * Bulk-loads GrammarSection records extracted by extract-grammar-sections.ts
 * into Firestore. Second half of the Phase 2 pipeline for the "Guide to
 * Japanese Verbs" grammar-corpus feature — see that script and the plan for
 * context.
 *
 * Dedup: compares each candidate's `pattern` against existing docs' `pattern`
 * (whitespace-collapsed, lowercased — but NOT space-stripped; see
 * normalizePattern's comment for why) and skips a match, making re-running
 * this script after correcting the input JSON safe. Separately, an explicit
 * hand-verified list (PHASE1_SEEDED_PATTERNS) catches the 3 Phase-1
 * hand-seeded sections (base3-deshou, ta-form-bakari, base1-zuni) even though
 * the bulk extraction re-derives them with slightly different spacing.
 *
 * Run from backend/: npx ts-node -r tsconfig-paths/register scripts/load-grammar-sections.ts <inFile>
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { FIRESTORE_CONNECTION, GRAMMAR_SECTIONS_COLLECTION } from '../src/firebase/firebase.module';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import * as fs from 'fs';

interface ExtractedSection {
  slug: string;
  sectionLabel: string;
  pattern: string;
  jlptLevel: string | null;
  explanation: string;
  examples: { japanese: string; english: string }[];
  vocab?: { term: string; reading: string | null; meaning: string }[] | null;
  notes?: string | null;
  sourceChapter: string;
}

/**
 * Trims + collapses whitespace runs (does NOT strip spaces entirely) — a
 * space can be the only thing distinguishing two genuinely different
 * patterns in this source doc (e.g. "Base 3 + の に" [nominalizer + に] vs
 * "Base 3 + のに" [concessive "although", JLPT N4] are different lessons).
 * A space-insensitive version of this function wrongly conflated those two
 * and silently dropped the のに section — so space-insensitivity is NOT used
 * as a general rule; see PHASE1_SEEDED_PATTERNS below for the one place it's
 * needed, applied only to a known, explicit, hand-verified list.
 */
function normalizePattern(pattern: string): string {
  return pattern.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The exact patterns hand-seeded in Phase 1 (seed-grammar-sections.ts), matched
 * space-insensitively — the bulk extraction re-derives these same 3 patterns
 * from the source doc but sometimes with different internal spacing (e.g.
 * "Base 1 + ずに" here vs extracted "Base 1 + ず に"). Space-insensitivity is
 * deliberately scoped to just this fixed, hand-verified list rather than
 * applied as a general dedup rule — see normalizePattern's comment.
 */
const PHASE1_SEEDED_PATTERNS = new Set(
  ['Base 3 + でしょう', 'た form + ばかり', 'Base 1 + ずに'].map((p) => normalizePattern(p).replace(/\s+/g, '')),
);

function isPhase1Duplicate(pattern: string): boolean {
  return PHASE1_SEEDED_PATTERNS.has(normalizePattern(pattern).replace(/\s+/g, ''));
}

async function main() {
  const [, , inFileArg] = process.argv;
  if (!inFileArg) {
    console.error('Usage: load-grammar-sections.ts <inFile>');
    process.exit(1);
  }

  const candidates: ExtractedSection[] = JSON.parse(fs.readFileSync(inFileArg, 'utf-8'));
  console.log(`Loaded ${candidates.length} candidates from ${inFileArg}`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const db = app.get<Firestore>(FIRESTORE_CONNECTION);

  const existingSnapshot = await db.collection(GRAMMAR_SECTIONS_COLLECTION).get();
  const existingPatterns = new Set(
    existingSnapshot.docs.map((doc) => normalizePattern((doc.data().pattern as string) ?? '')),
  );
  console.log(`Found ${existingPatterns.size} existing grammar sections in Firestore`);

  let written = 0;
  let skipped = 0;

  for (const c of candidates) {
    const norm = normalizePattern(c.pattern);
    if (existingPatterns.has(norm) || isPhase1Duplicate(c.pattern)) {
      console.log(`  skip (duplicate pattern): ${c.slug} ("${c.pattern}")`);
      skipped++;
      continue;
    }

    await db
      .collection(GRAMMAR_SECTIONS_COLLECTION)
      .doc(c.slug)
      .set(
        {
          sectionLabel: c.sectionLabel,
          pattern: c.pattern,
          jlptLevel: c.jlptLevel ?? null,
          explanation: c.explanation,
          examples: c.examples,
          vocab: c.vocab ?? [],
          notes: c.notes ?? null,
          createdAt: Timestamp.now(),
        },
        { merge: true },
      );
    existingPatterns.add(norm);
    written++;
    console.log(`  wrote: ${c.slug} ("${c.pattern}")`);
  }

  console.log(`\nDone. Wrote ${written} sections, skipped ${skipped} duplicates.`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
