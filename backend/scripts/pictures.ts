/**
 * Picture API from the command line: the same PicturesService steps the admin page uses,
 * called in-process (no HTTP, so no dev auth bypass involved). Writes GLOBAL data:
 * run render/attach/status only for a requested content run.
 *
 * Run from backend/:
 *   npx ts-node -r tsconfig-paths/register scripts/pictures.ts <command> [args]
 *
 * Subjects: --ku <kuId> [--usage <label>]   a usage of a Vocab word (default: first usage)
 *           --ku <kuId> --whole             the whole KU (any type, or a Concept id)
 *           (neither)                       free-standing; --note describes it
 *
 * Commands:
 *   list   [--ku <kuId>] [--status <s>] [--kind <k>]  list pictures (JSON lines)
 *   brief  <subject> [--note <text>]                  draft a brief; prints it, saves nothing
 *   render <subject> [--note <text>] [--brief <json>] [--style card|scene]
 *                                                     make a picture; waits and prints it
 *   redraw <pictureId> [--note <text>] [--brief <json>]   redraw; waits and prints it
 *   check  <pictureId>                                re-run the text check
 *   attach <pictureId> <subject>                      (re)attach; no subject = detach
 *   status <pictureId> <approved|needs-review|rejected|unpicturable>
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PictureStatus, PicturesService, PictureSubject } from '../src/pictures/pictures.service';
import { PictureBrief, PictureStyle } from '../src/prompts/picture.prompts';

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[a.slice(2)] = true;
      else {
        flags[a.slice(2)] = next;
        i++;
      }
    } else positional.push(a);
  }
  return { positional, flags };
}

const str = (v: string | true | undefined) => (typeof v === 'string' ? v : undefined);

function subjectFrom(flags: Record<string, string | true>): PictureSubject {
  const kuId = str(flags.ku);
  if (!kuId) return { kind: 'none' };
  return flags.whole ? { kind: 'ku', kuId } : { kind: 'ku-usage', kuId, usage: str(flags.usage) };
}

async function waitWhile(cond: () => boolean, timeoutMs = 5 * 60 * 1000) {
  const start = Date.now();
  while (cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for the render');
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!command) {
    console.error('Usage: see the header of scripts/pictures.ts');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const pictures = app.get(PicturesService);
  const brief = str(flags.brief) ? (JSON.parse(str(flags.brief)!) as PictureBrief) : undefined;
  const note = str(flags.note);
  const print = (x: unknown) => console.log(JSON.stringify(x, null, 2));

  try {
    switch (command) {
      case 'list': {
        const list = await pictures.list({
          kuId: str(flags.ku),
          status: str(flags.status) as PictureStatus | undefined,
          kind: str(flags.kind) as PictureSubject['kind'] | undefined,
        });
        for (const p of list) console.log(JSON.stringify({ id: p.id, kuId: p.kuId, content: p.content, usage: p.usage, kind: p.subject?.kind ?? 'ku-usage', status: p.status, file: p.file }));
        break;
      }
      case 'brief':
        print(await pictures.draftBrief(subjectFrom(flags), note));
        break;
      case 'render': {
        const { id } = await pictures.create({ subject: subjectFrom(flags), brief, note, style: str(flags.style) as PictureStyle | undefined });
        console.error(`Rendering ${id}…`);
        await waitWhile(() => pictures.getJob().rendering.some(r => r.id === id));
        print(await pictures.get(id));
        break;
      }
      case 'redraw': {
        const id = positional[0];
        await pictures.redraw(id, { brief, note });
        console.error(`Redrawing ${id}…`);
        await waitWhile(() => pictures.getJob().redrawing.includes(id));
        print(await pictures.get(id));
        break;
      }
      case 'check':
        print(await pictures.check(positional[0]));
        break;
      case 'attach':
        print(await pictures.attach(positional[0], subjectFrom(flags)));
        break;
      case 'status':
        print(await pictures.setStatus(positional[0], positional[1] as PictureStatus));
        break;
      default:
        throw new Error(`Unknown command ${command}`);
    }
  } finally {
    await app.close();
  }
}

main().catch(e => {
  console.error(e?.message ?? e);
  process.exit(1);
});
