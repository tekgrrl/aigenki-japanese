/**
 * Build Vocab lesson usages in bulk, in two steps so what's written is exactly what was reviewed:
 *
 *   1. Generate and review (writes nothing to Firestore):
 *        --dry-run --out=<file.json>    call Gemini once per lesson, print the usages, save the
 *                                       results to <file.json>
 *        --from-logs --out=<file.json>  the same, but taken from the api-logs of an earlier run
 *                                       (no Gemini calls). CAUTION: it pairs each logged response
 *                                       with the lesson's CURRENT examples; only use it if no
 *                                       examples were edited or regenerated since that run.
 *   2. Apply a reviewed file:
 *        --apply=<file.json>            write it (no Gemini calls); a lesson whose examples have
 *                                       changed since is skipped
 *
 * Selection (step 1): --only-multi (examples already carry 2+ distinct labels), --kuId=<id>,
 * --limit=<n>. Lessons whose usages are already built are skipped.
 *
 * Run from backend/:  npx ts-node -r tsconfig-paths/register scripts/build-usages.ts --dry-run --out=usages.json
 */
import 'dotenv/config';
import * as fs from 'fs';
import { NestFactory } from '@nestjs/core';
import type { Firestore } from 'firebase-admin/firestore';
import { AppModule } from '../src/app.module';
import { API_LOGS_COLLECTION, FIRESTORE_CONNECTION, LESSONS_COLLECTION } from '../src/firebase/firebase.module';
import { GeminiService } from '../src/gemini/gemini.service';
import { LessonsService } from '../src/lessons/lessons.service';
import { checkBuiltUsages } from '../src/lessons/vocab-usages';
import type { VocabLesson } from '../src/types';

/** One lesson's prompt input and raw output, as saved by step 1 and applied by step 2. */
interface Entry {
  kuId: string;
  vocab: string;
  definitions: string[];
  sentences: string[];
  fixedLabels: (string | null)[];
  raw: unknown;
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

async function main() {
  const applyFile = value('apply');
  const outFile = value('out');
  const fromLogs = flag('from-logs');
  if (!applyFile && !(outFile && (flag('dry-run') || fromLogs))) {
    console.error('Use --dry-run --out=<file>, --from-logs --out=<file>, or --apply=<file>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const db = app.get<Firestore>(FIRESTORE_CONNECTION);
  const lessons = app.get(LessonsService);

  if (applyFile) {
    const entries = JSON.parse(fs.readFileSync(applyFile, 'utf8')) as Entry[];
    let ok = 0;
    for (const e of entries) {
      const r = await lessons.saveBuiltUsages(e.kuId, e.raw, e.sentences, e.fixedLabels);
      if (r.saved) ok++;
      console.log(`${r.saved ? 'written' : 'NOT written'}: ${e.vocab} (${e.kuId})`);
    }
    console.log(`\nDone: ${ok} of ${entries.length} written`);
    await app.close();
    return;
  }

  const onlyKu = value('kuId');
  const limit = value('limit') ? Number(value('limit')) : Infinity;
  const docs = onlyKu
    ? [await db.collection(LESSONS_COLLECTION).doc(onlyKu).get()].filter(d => d.exists)
    : (await db.collection(LESSONS_COLLECTION).where('type', '==', 'Vocab').get()).docs;
  const todo = docs
    .map(d => ({ id: d.id, lesson: d.data() as VocabLesson }))
    .filter(({ lesson }) => (lesson.context_examples?.length ?? 0) > 0)
    .filter(({ lesson }) => !((lesson.usages?.length ?? 0) > 0 && lesson.context_examples!.every(e => e.usageId)))
    .filter(({ lesson }) => !flag('only-multi') || new Set(lesson.context_examples!.map(e => e.usage).filter(Boolean)).size > 1)
    .slice(0, limit);

  // --from-logs: the latest successful usage-building response per lesson.
  const logged = new Map<string, unknown>();
  if (fromLogs) {
    const logs = await db.collection(API_LOGS_COLLECTION).where('route', '==', '/lessons/build-usages').get();
    logs.docs
      .map(d => d.data())
      .filter(l => l.status === 'success' && l.responseData?.parsedJson)
      .sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis())
      .forEach(l => logged.set(l.requestData?.kuId, l.responseData.parsedJson));
  }

  const gemini = app.get(GeminiService);
  const entries: Entry[] = [];
  let failed = 0;
  console.log(`${todo.length} lesson(s)${fromLogs ? ' (from logs)' : ''}`);

  for (const { id, lesson } of todo) {
    const examples = lesson.context_examples!;
    const fixedLabels = examples.map(e => e.usage ?? null);
    const raw = fromLogs
      ? logged.get(id) ?? null
      : await gemini.buildExampleUsages(
          lesson.vocab, lesson.definitions ?? [], examples.map(e => ({ sentence: e.sentence, translation: e.translation })), fixedLabels, id, lesson.partOfSpeech,
        );
    try {
      if (!raw) throw new Error(fromLogs ? 'no logged response' : 'the call failed');
      const built = checkBuiltUsages(raw, examples.length, fixedLabels);
      console.log(`\n== ${lesson.vocab} (${id})  definitions: ${(lesson.definitions ?? []).join(' | ')}`);
      built.usages.forEach((u, i) => {
        const shownBy = built.exampleUsages.map((x, j) => (x === i ? j + 1 : null)).filter(Boolean).join(',');
        console.log(`   ${u.label}  →  meaning "${u.meaning}"  also: ${u.acceptedAnswers.join(', ') || '-'}  (examples ${shownBy})`);
      });
      if (built.setAside.length) console.log(`   set aside: ${built.setAside.join(' | ')}`);
      entries.push({ kuId: id, vocab: lesson.vocab, definitions: lesson.definitions ?? [], sentences: examples.map(e => e.sentence), fixedLabels, raw });
    } catch (e) {
      console.log(`\n!! ${lesson.vocab} (${id}) rejected: ${(e as Error).message}`);
      failed++;
    }
  }

  fs.writeFileSync(outFile!, JSON.stringify(entries, null, 2));
  console.log(`\nDone: ${entries.length} saved to ${outFile}, ${failed} rejected. Nothing written to Firestore.`);
  await app.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
