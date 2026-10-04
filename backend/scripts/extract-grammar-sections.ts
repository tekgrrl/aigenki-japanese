/**
 * Bulk-extracts GrammarSection candidates from the "Guide to Japanese Verbs"
 * source doc for the remaining ~80 sections (Phase 2 of the grammar-corpus
 * plan — Phase 1 hand-seeded 3 sections to prove the scenario-generation
 * directive). Input is the doc's raw published HTML, pre-split into one file
 * per chapter (at h1 boundaries) to keep each Gemini call's output bounded.
 * Uses Gemini + responseSchema, matching the extraction pattern already used
 * elsewhere in this codebase (scenario generation, pronunciation segmentation)
 * rather than hand-rolling a regex parser against genuinely messy source
 * (duplicate/out-of-order section numbers, footnote artifacts, a vocab entry
 * that leaked in as a heading, mixed Word Check formatting).
 *
 * Writes ALL extracted candidates to one JSON file for human review — this
 * script does NOT touch Firestore. See load-grammar-sections.ts for the
 * follow-up bulk-load step.
 *
 * Run from backend/:
 *   npx ts-node -r tsconfig-paths/register scripts/extract-grammar-sections.ts <chaptersDir> <outFile>
 */
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

interface ExtractedSection {
  sectionLabel: string;
  pattern: string;
  jlptLevel: string | null;
  explanation: string;
  examples: { japanese: string; english: string }[];
  vocab?: { term: string; reading: string | null; meaning: string }[] | null;
  notes?: string | null;
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          sectionLabel: { type: 'STRING', description: 'The source heading text, verbatim.' },
          pattern: { type: 'STRING', description: 'Short canonical pattern name, e.g. "た form + ばかり".' },
          jlptLevel: { type: 'STRING', nullable: true, description: 'N5-N1 only if explicitly stated in the heading/text.' },
          explanation: { type: 'STRING' },
          examples: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                japanese: { type: 'STRING' },
                english: { type: 'STRING' },
              },
              required: ['japanese', 'english'],
            },
          },
          vocab: {
            type: 'ARRAY',
            nullable: true,
            items: {
              type: 'OBJECT',
              properties: {
                term: { type: 'STRING' },
                reading: { type: 'STRING', nullable: true },
                meaning: { type: 'STRING' },
              },
              required: ['term', 'meaning'],
            },
          },
          notes: { type: 'STRING', nullable: true },
        },
        required: ['sectionLabel', 'pattern', 'explanation', 'examples'],
      },
    },
  },
  required: ['sections'],
};

const SYSTEM_PROMPT = `You are extracting structured lesson records from one chapter of a hand-authored Japanese grammar/verb reference document. The input is raw Google-Docs-exported HTML for this chapter — ignore all CSS classes, inline colors, and other styling entirely; they carry no semantic meaning here (in particular, some spans render visually white due to an authoring artifact, but their text is ordinary body content and must be extracted normally, never dropped or treated as hidden).

The document is organized with headings (h1/h2/h3) introducing lesson sections, each followed by prose explanation, numbered Japanese/English example sentence pairs, sometimes a "Word Check" vocabulary list (as a <ul>), sometimes a conjugation <table>, and occasional extra notes.

The document has known messiness you must work around:
- Section numbers are sometimes duplicated or out of order (e.g. two different headings both labeled "Lesson 77") — this is fine, just copy each heading's text verbatim into sectionLabel.
- A few headings are not real lessons at all — e.g. a lone vocabulary entry that leaked in as a heading, "Summary" or "Vocabulary List" recap headings, exercise-only headings with no new pattern. Skip these.
- Footnote-like superscript characters may contaminate inline text — clean these out of the text you extract.

For EACH heading that introduces an actual grammar pattern or construction — anything a learner would produce in a sentence (a verb form, a particle construction, a conjugation, a sentence-ending pattern) — emit one object with:
- sectionLabel: the heading text, verbatim (including its number/lesson prefix if present).
- pattern: a short, clean canonical name for the pattern (e.g. "Base 3 + でしょう", "た form + ばかり"), not the whole heading sentence.
- jlptLevel: "N5"|"N4"|"N3"|"N2"|"N1" ONLY if explicitly stated in the heading or text (e.g. "[JLPT N4]"); otherwise null. Do not guess a level that isn't stated.
- explanation: a clear, complete prose explanation of the rule, synthesized from the surrounding paragraph text. Clean up any garbled or fragmentary source text, but do not invent claims not present in the source.
- examples: ALL numbered Japanese/English example sentence pairs given for this section, copied faithfully from the source — do not invent new examples, do not omit any that belong to this section.
- vocab: the section's own "Word Check" vocabulary list, if present (term, reading if given, meaning). Omit or use an empty array if there isn't one.
- notes: any extra usage notes, warnings, or irregular-case call-outs mentioned for this pattern (e.g. an irregular conjugation). Omit if none.

Do NOT extract: chapter-intro/framing sections with no specific pattern (e.g. general "Core Concepts" or "Verb Conjugation" overviews), pure recap/summary sections, standalone vocabulary-list appendices not tied to one pattern, notes about IME/typing/romanization, and exercise-only sections that don't introduce a new pattern.

Author-attributed essays about specific grammar constructions (e.g. notes on giving/receiving verbs like あげる/くれる/もらう) DO count as real grammar patterns — extract them normally.

Return every legitimate lesson section in this chapter; do not artificially limit the count.`;

function slugify(pattern: string, seen: Set<string>): string {
  const base =
    pattern
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'section';
  let slug = base;
  let i = 2;
  while (seen.has(slug)) {
    slug = `${base}-${i++}`;
  }
  seen.add(slug);
  return slug;
}

async function main() {
  const [, , chaptersDirArg, outFileArg] = process.argv;
  const chaptersDir = chaptersDirArg;
  const outFile = outFileArg || path.join(__dirname, 'data', 'extracted-grammar-sections.json');

  if (!chaptersDir) {
    console.error('Usage: extract-grammar-sections.ts <chaptersDir> [outFile]');
    console.error('  <chaptersDir> must contain manifest.json and the per-chapter .html files it lists.');
    process.exit(1);
  }

  const manifestPath = path.join(chaptersDir, 'manifest.json');
  const manifest: { file: string; title: string; chars: number }[] = JSON.parse(
    fs.readFileSync(manifestPath, 'utf-8'),
  );

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const modelName = process.env.GEMINI_MODEL || process.env.MODEL_GEMINI_FLASH || 'gemini-3-flash-preview';
  console.log(`Using model: ${modelName}`);

  const client = new GoogleGenAI({ apiKey });

  const seenSlugs = new Set<string>();
  const allSections: (ExtractedSection & { slug: string; sourceChapter: string })[] = [];

  for (const entry of manifest) {
    const htmlPath = path.join(chaptersDir, entry.file);
    const html = fs.readFileSync(htmlPath, 'utf-8');
    console.log(`\nExtracting ${entry.file} ("${entry.title || '(untitled)'}", ${entry.chars} chars)...`);

    let response;
    try {
      response = await client.models.generateContent({
        model: modelName,
        contents: [
          { parts: [{ text: `Chapter heading: ${entry.title || '(untitled)'}\n\nRaw HTML:\n${html}` }] },
        ],
        config: {
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA as any,
          temperature: 0.1,
        },
      });
    } catch (err) {
      console.error(`  ! Gemini call failed for ${entry.file}:`, err);
      continue;
    }

    if (!response.text) {
      console.error(`  ! empty response for ${entry.file}, skipping`);
      continue;
    }

    let parsed: { sections: ExtractedSection[] };
    try {
      parsed = JSON.parse(response.text);
    } catch (e) {
      console.error(`  ! failed to parse JSON for ${entry.file}:`, e);
      fs.writeFileSync(path.join(chaptersDir, entry.file + '.error.txt'), response.text);
      continue;
    }

    for (const s of parsed.sections) {
      const slug = slugify(s.pattern, seenSlugs);
      allSections.push({ ...s, slug, sourceChapter: entry.title || '(untitled)' });
    }
    console.log(`  -> ${parsed.sections.length} sections`);
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(allSections, null, 2), 'utf-8');
  console.log(`\nDone. Extracted ${allSections.length} sections total -> ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
