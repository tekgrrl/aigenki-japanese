#!/usr/bin/env node
/**
 * Generates Grammar KUs from a pattern list and imports them to Firestore.
 *
 * Usage:
 *   node scripts/generate-grammar-kus.js <input.json> [--dry-run]
 *
 * Input JSON format (array of objects or strings):
 *   [
 *     { "pattern": "～は～です", "jlptLevel": "N5" },
 *     { "pattern": "～が好き",   "jlptLevel": "N5" }
 *   ]
 *   -- or with a global level --
 *   { "jlptLevel": "N5", "patterns": ["～は～です", "～が好き"] }
 *
 * Env:
 *   GEMINI_API_KEY  required
 *   GEMINI_MODEL    optional, defaults to gemini-2.0-flash
 */

const admin = require("firebase-admin");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");

// ── Config ────────────────────────────────────────────────────────────────────
const PROJECT_ID = "gen-lang-client-0878434798";
const DATABASE_ID = "aisrs-japanese-dev";
const COLLECTION = "knowledge-units";
const DELAY_MS = 1200; // stay well under Gemini free-tier rate limit

const isDryRun = process.argv.includes("--dry-run");
const inputPath = process.argv.find((a) => a.endsWith(".json"));

if (!inputPath) {
  console.error("Usage: node generate-grammar-kus.js <input.json> [--dry-run]");
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY env var is required");
  process.exit(1);
}

// ── Firebase ──────────────────────────────────────────────────────────────────
admin.initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(admin.app(), DATABASE_ID);

// ── Gemini ────────────────────────────────────────────────────────────────────
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const modelName = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

const SYSTEM_PROMPT = `You are a Japanese grammar expert creating structured learning data.
For each grammar pattern you receive, generate a JSON object with exactly this shape:
{
  "title": "Human-readable name (e.g. 'Topic marker は')",
  "explanation": "1-2 sentence explanation of what the pattern expresses and when to use it",
  "exampleInContext": {
    "japanese": "A natural, complete Japanese sentence using the pattern",
    "english": "Natural English translation",
    "fragments": ["the", "sentence", "split", "into", "meaningful", "chunks"],
    "accepted_alternatives": ["any alternative correct responses the user might write"]
  }
}

Fragment rules (most important):
- Split at every particle and verb/adjective boundary — each particle must be its own fragment OR consistently attached to the preceding noun across the whole sentence, never mixed
- Preferred style: attach particles to the noun they follow (e.g. "友達と", "デパートへ") so each fragment reads as a natural unit
- Verb endings and auxiliaries stay with the verb stem (e.g. "行きました" as one fragment, not split)
- Every character in the japanese sentence must appear in exactly one fragment — no characters dropped or duplicated
- Aim for 3–6 fragments; avoid single-character fragments unless the particle stands alone naturally (e.g. "は" as topic marker contrast)

Other rules:
- accepted_alternatives should include common valid variants (different politeness levels, particle choices, kanji/kana variants, with/without trailing punctuation) — can be empty array if there are none
- Keep the example sentence appropriate for the given JLPT level
- Do NOT include romaji anywhere
- Return ONLY the JSON object, no markdown fences or extra text`;

async function generateKuData(pattern, jlptLevel) {
  const userMessage = `Grammar pattern: ${pattern}\nJLPT level: ${jlptLevel}\n\nGenerate the KU data JSON.`;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
    },
  });

  const raw = response.text?.trim();
  if (!raw) throw new Error("Empty response from Gemini");
  return JSON.parse(raw);
}

async function alreadyExists(pattern) {
  const snap = await db
    .collection(COLLECTION)
    .where("content", "==", pattern)
    .where("type", "==", "Grammar")
    .limit(1)
    .get();
  return !snap.empty;
}

async function writeKu(pattern, jlptLevel, data) {
  const docRef = db.collection(COLLECTION).doc();
  const ku = {
    type: "Grammar",
    content: pattern,
    jlptLevel,
    relatedUnits: [],
    userId: "",
    personalNotes: "",
    facet_count: 0,
    createdAt: Timestamp.now(),
    data: {
      title: data.title,
      explanation: data.explanation,
      exampleInContext: {
        japanese: data.exampleInContext.japanese,
        english: data.exampleInContext.english,
        fragments: data.exampleInContext.fragments,
        accepted_alternatives: data.exampleInContext.accepted_alternatives,
      },
    },
  };
  await docRef.set(ku);
  return docRef.id;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));

  // Normalise input to [{ pattern, jlptLevel }]
  let items;
  if (Array.isArray(raw)) {
    items = raw.map((entry) =>
      typeof entry === "string"
        ? { pattern: entry, jlptLevel: "N5" }
        : { pattern: entry.pattern, jlptLevel: entry.jlptLevel || "N5" }
    );
  } else {
    const level = raw.jlptLevel || "N5";
    items = (raw.patterns || []).map((p) => ({ pattern: p, jlptLevel: level }));
  }

  console.log(
    `\nGenerating ${items.length} Grammar KUs [${isDryRun ? "DRY RUN" : "LIVE"}]\n`
  );

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const { pattern, jlptLevel } = items[i];
    process.stdout.write(`[${i + 1}/${items.length}] ${pattern} ... `);

    try {
      if (!isDryRun && (await alreadyExists(pattern))) {
        console.log("SKIP (already exists)");
        skipped++;
        continue;
      }

      const data = await generateKuData(pattern, jlptLevel);

      if (isDryRun) {
        console.log("OK (dry run)");
        console.log(JSON.stringify(data, null, 2));
      } else {
        const id = await writeKu(pattern, jlptLevel, data);
        console.log(`OK → ${id}`);
        created++;
      }
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failed++;
    }

    if (i < items.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nDone. created=${created} skipped=${skipped} failed=${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
