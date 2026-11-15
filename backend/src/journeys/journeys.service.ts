/**
 * Journeys: the course structure, built in the admin Journey planner. A Journey is ordered phases;
 * each phase's taught items, allowed items and brief are written down onto its pool scenarios,
 * which are generated from them. A learner's progress is worked out from their scenario docs and
 * review cards on every read; only a Journey's completion is stored, the first time it's met.
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import {
  FIRESTORE_CONNECTION, JOURNEYS_COLLECTION, JOURNEY_PROGRESS_SUBCOLLECTION, KNOWLEDGE_UNITS_COLLECTION, SCENARIO_POOL_COLLECTION,
} from '../firebase/firebase.module';
import { scenarioPassed, ScenariosService, VOCAB_READY_MIN_STAGE } from '../scenarios/scenarios.service';
import { DEFAULT_PHASE_PASSING, ItemRule, Journey, JourneyPhase, JourneyStatus, LearnerJourney, PhaseItems } from '../types/journey';
import { PoolScenario, Scenario } from '../types/scenario';

/**
 * What the planner sends. Taught / extra-allowed Vocab may be words or `{ content, kuId }`;
 * Grammar may be KU ids or patterns (`grammar`, or the stored `grammarKuIds`). Everything else
 * is optional and gets a default.
 */
export type JourneyInput = Partial<Omit<Journey, 'id' | 'phases'>> & { phases?: PhaseInput[] };
type ItemsInput = { vocab?: unknown[]; grammar?: unknown[]; grammarKuIds?: unknown[] };
type PhaseInput = Partial<Omit<JourneyPhase, 'taught' | 'extraAllowed' | 'passing'>> & {
  taught?: ItemsInput;
  extraAllowed?: ItemsInput;
  passing?: Partial<JourneyPhase['passing']>;
};

type PoolEntry = { pool: PoolScenario; learner: Scenario | null };
type Stages = Record<string, { minSrsStage: number | null }>;

const emptyItems = (): PhaseItems => ({ vocab: [], grammarKuIds: [] });
const itemIds = (items: PhaseItems): string[] => [...items.vocab.map(v => v.kuId), ...items.grammarKuIds];

/** Adds `more` to `into`, skipping anything already there. */
function addItems(into: PhaseItems, more: PhaseItems): void {
  for (const v of more.vocab) if (!into.vocab.some(x => x.kuId === v.kuId)) into.vocab.push(v);
  for (const g of more.grammarKuIds) if (!into.grammarKuIds.includes(g)) into.grammarKuIds.push(g);
}

/** A stored Journey with defaults for anything it predates (phases saved before the planner). */
export function normalizeJourney(raw: Journey): Journey {
  return {
    ...raw,
    summary: raw.summary ?? '',
    phases: (raw.phases ?? []).map((p, i) => ({
      id: p.id ?? `legacy-${i}`,
      title: p.title ?? '',
      notes: p.notes,
      goalSummary: p.goalSummary ?? '',
      taught: { vocab: p.taught?.vocab ?? [], grammarKuIds: p.taught?.grammarKuIds ?? [] },
      extraAllowed: { vocab: p.extraAllowed?.vocab ?? [], grammarKuIds: p.extraAllowed?.grammarKuIds ?? [] },
      setPhrases: p.setPhrases ?? [],
      simulationBrief: p.simulationBrief ?? '',
      interstitials: p.interstitials ?? [],
      passing: { ...DEFAULT_PHASE_PASSING, ...(p.passing ?? {}) },
      unlock: p.unlock ?? 'after-previous',
      poolIds: p.poolIds ?? [],
    })),
  };
}

/**
 * For each phase id: what its scenarios may use beyond what it teaches. That's everything taught
 * in earlier Journeys (in course order) and earlier phases of its own Journey, plus its extras.
 */
export function allowedByPhase(journeys: Journey[]): Map<string, PhaseItems> {
  const out = new Map<string, PhaseItems>();
  const before = emptyItems();
  for (const j of journeys) {
    for (const p of j.phases) {
      const allowed = emptyItems();
      addItems(allowed, before);
      addItems(allowed, p.extraAllowed);
      // Taught here wins: an item isn't both taught and merely allowed.
      const taught = new Set(itemIds(p.taught));
      out.set(p.id, {
        vocab: allowed.vocab.filter(v => !taught.has(v.kuId)),
        grammarKuIds: allowed.grammarKuIds.filter(g => !taught.has(g)),
      });
      addItems(before, p.taught);
    }
  }
  return out;
}

/** True when at least `rule.share` of the items have every card at `rule.minStage` or above (no items: true). */
export function ruleMet(ids: string[], stages: Stages, rule: ItemRule): boolean {
  if (ids.length === 0) return true;
  return countReady(ids, stages, rule.minStage) / ids.length >= rule.share - 1e-9;
}

const countReady = (ids: string[], stages: Stages, minStage: number) =>
  ids.filter(id => (stages[id]?.minSrsStage ?? -1) >= minStage).length;

@Injectable()
export class JourneysService {
  constructor(
    @Inject(FIRESTORE_CONNECTION) private readonly db: Firestore,
    private readonly scenarios: ScenariosService,
  ) {}

  private col() {
    return this.db.collection(JOURNEYS_COLLECTION);
  }

  /** All Journeys in course order. */
  async list(): Promise<Journey[]> {
    const snap = await this.col().get();
    return snap.docs
      .map(d => normalizeJourney(d.data() as Journey))
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  }

  /**
   * Admin: every Journey, plus the names the planner shows for stored ids (Grammar patterns,
   * Concept titles) and each phase's worked-out allowed items.
   */
  async listForPlanner(): Promise<{ journeys: Journey[]; names: Record<string, string>; allowed: Record<string, PhaseItems> }> {
    const journeys = await this.list();
    const ids = new Set<string>();
    const allowed = allowedByPhase(journeys);
    for (const j of journeys) for (const p of j.phases) {
      p.taught.grammarKuIds.forEach(id => ids.add(id));
      p.extraAllowed.grammarKuIds.forEach(id => ids.add(id));
      allowed.get(p.id)?.grammarKuIds.forEach(id => ids.add(id));
      p.interstitials.forEach(i => i.conceptKuId && ids.add(i.conceptKuId));
    }
    const names: Record<string, string> = {};
    if (ids.size) {
      const kus = this.db.collection(KNOWLEDGE_UNITS_COLLECTION);
      const docs = await this.db.getAll(...[...ids].map(id => kus.doc(id)));
      docs.forEach(d => { if (d.exists) names[d.id] = String(d.data()!.content ?? d.id); });
    }
    return { journeys, names, allowed: Object.fromEntries(allowed) };
  }

  /**
   * The course as one learner sees it. A Journey opens when the Journeys it waits for are done
   * (by default the previous one); it's done when every phase is and its overall rule (if any) is
   * met, and that's recorded once so a later lapse doesn't re-lock what follows. A phase opens
   * with the Journey or after the previous phase, and is done on enough scenario passes plus
   * its taught items meeting its stage rule.
   */
  async forLearner(uid: string): Promise<LearnerJourney[]> {
    const journeys = await this.list();
    const scenarios = await this.scenarios.poolScenariosFor(uid, journeys.flatMap(j => j.phases.flatMap(p => p.poolIds)));
    const progress = this.db.collection('users').doc(uid).collection(JOURNEY_PROGRESS_SUBCOLLECTION);
    const records = journeys.length ? await this.db.getAll(...journeys.map(j => progress.doc(j.id))) : [];
    const recorded = new Set(journeys.filter((_, i) => records[i].exists).map(j => j.id));

    const done = new Set<string>();
    const out: LearnerJourney[] = [];
    for (const [ji, j] of journeys.entries()) {
      const waitsFor = j.unlockAfter ?? (ji > 0 ? [journeys[ji - 1].id] : []);
      const unlocked = waitsFor.every(id => done.has(id));
      const isRecorded = recorded.has(j.id);
      // Item stages are only read where they decide something: an open Journey not yet recorded.
      const live = unlocked && !isRecorded;
      const phaseItems = j.phases.map(p => this.phaseItemIds(p, scenarios));
      const allIds = [...new Set(phaseItems.flat())];
      const stages: Stages = live && allIds.length ? await this.scenarios.itemStages(uid, allIds) : {};

      let previousDone = true;
      const phases = j.phases.map((p, pi) => {
        const choices = p.poolIds
          .map(id => ({ id, entry: scenarios.get(id) }))
          .filter((c): c is { id: string; entry: PoolEntry } => !!c.entry)
          .map(({ id, entry }) => ({
            poolId: id,
            title: entry.pool.title,
            description: entry.pool.description,
            difficultyLevel: entry.pool.difficultyLevel,
            situationTags: entry.pool.situationTags ?? [],
            started: !!entry.learner,
            passed: scenarioPassed(entry.learner),
          }));
        const passes = choices.filter(c => c.passed).length;
        // The item rule counts taught items only: a phase not yet seeded in the planner passes
        // on scenario passes alone, as before (its fallback items are shown, not required).
        const phaseDone = isRecorded || (passes >= Math.min(p.passing.scenarioPasses, Math.max(choices.length, 1))
          && ruleMet(itemIds(p.taught), stages, p.passing));
        const open = pi === 0 || p.unlock === 'open' || previousDone;
        previousDone = phaseDone;
        const status: JourneyStatus = phaseDone ? 'done' : open ? 'current' : 'locked';
        return {
          id: p.id,
          title: p.title,
          status,
          done: phaseDone,
          ...(live ? { goals: { ready: countReady(phaseItems[pi], stages, p.passing.minStage), total: phaseItems[pi].length } } : {}),
          passing: p.passing,
          scenarios: choices,
        };
      });

      const taughtIds = [...new Set(j.phases.flatMap(p => itemIds(p.taught)))];
      const met = isRecorded || (unlocked && phases.length > 0 && phases.every(p => p.done) && (!j.passing || ruleMet(taughtIds, stages, j.passing)));
      if (met) done.add(j.id);
      if (met && !isRecorded) await progress.doc(j.id).set({ journeyId: j.id, completedAt: Timestamp.now() });

      const status: JourneyStatus = met ? 'done' : unlocked ? 'current' : 'locked';
      out.push({
        id: j.id,
        title: j.title,
        summary: j.summary,
        difficultyLevel: j.difficultyLevel,
        order: j.order,
        status,
        unlockAfterTitles: waitsFor.map(id => journeys.find(x => x.id === id)?.title ?? id),
        ...(status === 'current'
          ? { goals: { ready: countReady(allIds, stages, j.passing?.minStage ?? VOCAB_READY_MIN_STAGE), total: allIds.length } }
          : {}),
        phases,
      });
    }
    return out;
  }

  /**
   * A phase's goal items: what it teaches. A phase built before the planner (nothing taught yet)
   * falls back to its scenarios' goals, or their generated Key items with KU ids.
   */
  private phaseItemIds(phase: JourneyPhase, scenarios: Map<string, PoolEntry>): string[] {
    const taught = itemIds(phase.taught);
    if (taught.length) return [...new Set(taught)];
    const ids = new Set<string>();
    for (const poolId of phase.poolIds) {
      const entry = scenarios.get(poolId);
      if (!entry) continue;
      if (entry.pool.goals) {
        entry.pool.goals.vocab.forEach(v => ids.add(v.kuId));
        entry.pool.goals.grammarKuIds.forEach(id => ids.add(id));
        continue;
      }
      for (const ku of entry.learner?.extractedKUs ?? entry.pool.extractedKUs ?? []) if (ku.kuId) ids.add(ku.kuId);
      for (const g of entry.pool.grammarMatches ?? []) if (g.kuId) ids.add(g.kuId);
    }
    return [...ids];
  }

  /** Admin: create a Journey. */
  async create(input: JourneyInput): Promise<Journey> {
    const ref = this.col().doc();
    const journey = { ...(await this.validated(input, ref.id)), id: ref.id };
    await ref.set(journey);
    await this.writeDownToPool();
    return journey;
  }

  /** Admin: replace a Journey. */
  async update(id: string, input: JourneyInput): Promise<Journey> {
    const ref = this.col().doc(id);
    if (!(await ref.get()).exists) throw new NotFoundException('Journey not found');
    const journey = { ...(await this.validated(input, id)), id };
    await ref.set(journey);
    await this.writeDownToPool();
    return journey;
  }

  /** Admin: delete a Journey (its pool scenarios keep their content; learners' progress is untouched). */
  async remove(id: string): Promise<void> {
    const ref = this.col().doc(id);
    if (!(await ref.get()).exists) throw new NotFoundException('Journey not found');
    await ref.delete();
    await this.writeDownToPool();
  }

  /**
   * Writes every phase onto its pool scenarios (goals, allowed items, brief, owner), and releases
   * pool scenarios no longer in any phase. Every Journey is rewritten, since an earlier Journey's
   * taught items are a later one's allowed items. Unchanged scenarios keep their generated scene.
   * A phase that teaches nothing yet (built before the planner, not seeded) is skipped, so its
   * scenarios keep the goals they were given in the pool editor.
   */
  private async writeDownToPool(): Promise<void> {
    const journeys = await this.list();
    const allowed = allowedByPhase(journeys);
    const owned = new Set<string>();
    for (const j of journeys) for (const p of j.phases) for (const poolId of p.poolIds) {
      if (itemIds(p.taught).length === 0) continue;
      owned.add(poolId);
      await this.scenarios.applyPhaseToPool(poolId, {
        goals: { summary: p.goalSummary, vocab: p.taught.vocab, grammarKuIds: p.taught.grammarKuIds, setPhrases: p.setPhrases },
        allowed: allowed.get(p.id) ?? emptyItems(),
        simulationBrief: p.simulationBrief,
        phaseRef: { journeyId: j.id, journeyTitle: j.title, phaseId: p.id, phaseTitle: p.title },
      });
    }
    const pool = await this.db.collection(SCENARIO_POOL_COLLECTION).get();
    for (const d of pool.docs) {
      if ((d.data() as PoolScenario).phaseRef && !owned.has(d.id)) await this.scenarios.releaseFromPhase(d.id);
    }
  }

  /**
   * Checks and cleans an admin's Journey: title, numeric order, titled phases with ids, real pool
   * ids each in one phase only (across all Journeys), unlock-after naming earlier Journeys, sane
   * passing rules, and goal lines resolved to KUs.
   */
  private async validated(input: JourneyInput, selfId: string): Promise<Omit<Journey, 'id'>> {
    const title = (input?.title ?? '').trim();
    if (!title) throw new BadRequestException('A Journey needs a title');
    const order = Number(input.order);
    if (!Number.isFinite(order)) throw new BadRequestException('order must be a number');

    const others = (await this.list()).filter(j => j.id !== selfId);
    const phases: JourneyPhase[] = [];
    for (const p of Array.isArray(input.phases) ? input.phases : []) {
      const phaseTitle = (p?.title ?? '').trim();
      if (!phaseTitle) throw new BadRequestException('Every phase needs a title');
      const taught = await this.scenarios.resolveGoalLines(p.taught?.vocab, p.taught?.grammar ?? p.taught?.grammarKuIds);
      const extraAllowed = await this.scenarios.resolveGoalLines(p.extraAllowed?.vocab, p.extraAllowed?.grammar ?? p.extraAllowed?.grammarKuIds);
      phases.push({
        id: typeof p.id === 'string' && p.id && !p.id.startsWith('legacy-') ? p.id : randomUUID(),
        title: phaseTitle,
        ...(p.notes?.trim() ? { notes: p.notes.trim() } : {}),
        goalSummary: (p.goalSummary ?? '').trim(),
        taught,
        extraAllowed,
        setPhrases: [...new Set((Array.isArray(p.setPhrases) ? p.setPhrases : []).map(x => String(x).trim()).filter(Boolean))],
        simulationBrief: (p.simulationBrief ?? '').trim(),
        interstitials: (Array.isArray(p.interstitials) ? p.interstitials : [])
          .map(i => ({ title: String(i?.title ?? '').trim(), conceptKuId: String(i?.conceptKuId ?? '').trim(), notes: String(i?.notes ?? '').trim() }))
          .filter(i => i.title)
          .map(i => ({ title: i.title, ...(i.conceptKuId ? { conceptKuId: i.conceptKuId } : {}), ...(i.notes ? { notes: i.notes } : {}) })),
        passing: {
          scenarioPasses: this.intIn(p.passing?.scenarioPasses ?? DEFAULT_PHASE_PASSING.scenarioPasses, 1, 20, 'Scenario passes'),
          ...this.rule(p.passing, DEFAULT_PHASE_PASSING),
        },
        unlock: p.unlock === 'open' ? 'open' : 'after-previous',
        poolIds: [...new Set((Array.isArray(p.poolIds) ? p.poolIds : []).filter((id): id is string => typeof id === 'string' && !!id))],
      });
    }

    const ids = phases.flatMap(p => p.poolIds);
    const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (repeated.length) throw new BadRequestException(`A scenario can only be in one phase: ${[...new Set(repeated)].join(', ')}`);
    const elsewhere = ids.filter(id => others.some(j => j.phases.some(p => p.poolIds.includes(id))));
    if (elsewhere.length) throw new BadRequestException(`Already in another Journey's phase: ${elsewhere.join(', ')}`);
    if (ids.length) {
      const pool = this.db.collection(SCENARIO_POOL_COLLECTION);
      const docs = await this.db.getAll(...ids.map(id => pool.doc(id)));
      const missing = ids.filter((_, i) => !docs[i].exists);
      if (missing.length) throw new BadRequestException(`Unknown pool scenario(s): ${missing.join(', ')}`);
    }

    const unlockAfter = Array.isArray(input.unlockAfter) ? [...new Set(input.unlockAfter.filter(id => typeof id === 'string' && id))] : undefined;
    for (const id of unlockAfter ?? []) {
      const before = others.find(j => j.id === id);
      if (!before) throw new BadRequestException(`Unlock after: unknown Journey ${id}`);
      if (before.order >= order) throw new BadRequestException(`Unlock after: "${before.title}" must come earlier in the course`);
    }

    return {
      title,
      summary: (input.summary ?? '').trim(),
      difficultyLevel: (input.difficultyLevel ?? 'N5').trim() || 'N5',
      order,
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      ...(unlockAfter ? { unlockAfter } : {}),
      ...(input.passing ? { passing: this.rule(input.passing, { minStage: VOCAB_READY_MIN_STAGE, share: 1 }) } : {}),
      phases,
    };
  }

  private rule(input: Partial<ItemRule> | undefined, fallback: ItemRule): ItemRule {
    const share = Number(input?.share ?? fallback.share);
    if (!Number.isFinite(share) || share < 0 || share > 1) throw new BadRequestException('A share must be between 0 and 1');
    return { minStage: this.intIn(input?.minStage ?? fallback.minStage, 0, 9, 'Stage'), share };
  }

  private intIn(value: unknown, min: number, max: number, what: string): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new BadRequestException(`${what} must be a whole number from ${min} to ${max}`);
    return n;
  }
}
