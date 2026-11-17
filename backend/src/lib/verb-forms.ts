/**
 * Verb forms as data: conjugating a verb into the forms Grammar notation asks for ({V-masu},
 * {V-te}, {V-ta}, {V-nai}), and the ending groups each form is learned in. A verb-form *skill* is
 * one form + one group ("て-form of godan verbs in む/ぶ/ぬ"): the abstract rule, not one verb.
 * Pure: no Firestore, so the learner-progress service and the review cards share it.
 */

export type VerbForm = 'masu' | 'te' | 'ta' | 'nai';
export type ConjugationType = 'godan' | 'ichidan' | 'irregular';

export interface Verb {
  /** The headword as stored on the KU (待つ, 気を付ける, 勉強する). */
  content: string;
  /** Its kana reading (まつ, きをつける, べんきょうする). */
  reading: string;
  conjugationType: ConjugationType;
}

export interface Conjugated {
  group: string;
  /** The form written like the headword (待って). Same as `kana` for a kana headword. */
  written: string;
  /** The form in kana (まって). */
  kana: string;
}

/** The ending groups of each form, in teaching order. Groups differ by form: ない only cares about う vs the rest. */
export const FORM_GROUPS: Record<VerbForm, readonly { id: string; label: string }[]> = {
  masu: [
    { id: 'ichidan', label: 'ichidan (る drops)' },
    { id: 'godan', label: 'godan (u → i)' },
    { id: 'suru', label: 'する → し' },
    { id: 'kuru', label: '来る → 来(き)' },
  ],
  te: [
    { id: 'ichidan', label: 'ichidan → て' },
    { id: 'godan-u-tsu-ru', label: 'godan う/つ/る → って' },
    { id: 'godan-mu-bu-nu', label: 'godan む/ぶ/ぬ → んで' },
    { id: 'godan-ku', label: 'godan く → いて' },
    { id: 'godan-gu', label: 'godan ぐ → いで' },
    { id: 'godan-su', label: 'godan す → して' },
    { id: 'iku', label: '行く → 行って' },
    { id: 'suru', label: 'する → して' },
    { id: 'kuru', label: '来る → 来(き)て' },
  ],
  ta: [
    { id: 'ichidan', label: 'ichidan → た' },
    { id: 'godan-u-tsu-ru', label: 'godan う/つ/る → った' },
    { id: 'godan-mu-bu-nu', label: 'godan む/ぶ/ぬ → んだ' },
    { id: 'godan-ku', label: 'godan く → いた' },
    { id: 'godan-gu', label: 'godan ぐ → いだ' },
    { id: 'godan-su', label: 'godan す → した' },
    { id: 'iku', label: '行く → 行った' },
    { id: 'suru', label: 'する → した' },
    { id: 'kuru', label: '来る → 来(き)た' },
  ],
  nai: [
    { id: 'ichidan', label: 'ichidan → ない' },
    { id: 'godan-u', label: 'godan う → わない' },
    { id: 'godan-other', label: 'godan (u → a) + ない' },
    { id: 'aru', label: 'ある → ない' },
    { id: 'suru', label: 'する → しない' },
    { id: 'kuru', label: '来る → 来(こ)ない' },
  ],
};

export const VERB_FORMS = Object.keys(FORM_GROUPS) as VerbForm[];

export const skillId = (form: VerbForm, group: string) => `verb-form:${form}:${group}`;

export function parseSkillId(id: string): { form: VerbForm; group: string } | null {
  const m = /^verb-form:(masu|te|ta|nai):([a-z-]+)$/.exec(id);
  return m && FORM_GROUPS[m[1] as VerbForm].some(g => g.id === m[2]) ? { form: m[1] as VerbForm, group: m[2] } : null;
}

/** Every verb-form skill, form by form, in teaching order. */
export const ALL_VERB_FORM_SKILLS = VERB_FORMS.flatMap(f => FORM_GROUPS[f].map(g => skillId(f, g.id)));

/** The verb forms a Grammar point's notation asks for (`{V-te}ください` → ['te']). {V-dict} has nothing to conjugate. */
export function slotForms(content: string): VerbForm[] {
  const forms = [...(content ?? '').matchAll(/\{V-(masu|te|ta|nai)\}/g)].map(m => m[1] as VerbForm);
  return [...new Set(forms)];
}

/**
 * What a Grammar point's notation writes straight after a verb slot of this form: the part a drill's
 * blank must include, so the drill tests the pattern and not just the conjugation
 * (`{V-masu}ました` → ['ました']). One entry per variant (`{V-te}います / {V-te}いる` → ['います', 'いる']);
 * [''] when nothing follows (`{V-ta}`, `{V-te}、{Cl}`).
 */
export function patternTails(content: string, form: VerbForm): string[] {
  const tails = [...(content ?? '').matchAll(new RegExp(`\\{V-${form}\\}([^{\\s/、。+]*)`, 'g'))].map(m => m[1]);
  return tails.length > 0 ? [...new Set(tails)] : [''];
}

const I_ROW: Record<string, string> = { う: 'い', く: 'き', ぐ: 'ぎ', す: 'し', つ: 'ち', ぬ: 'に', ぶ: 'び', む: 'み', る: 'り' };
const A_ROW: Record<string, string> = { う: 'わ', く: 'か', ぐ: 'が', す: 'さ', つ: 'た', ぬ: 'な', ぶ: 'ば', む: 'ま', る: 'ら' };
const TE: Record<string, { te: string; group: string }> = {
  う: { te: 'って', group: 'godan-u-tsu-ru' }, つ: { te: 'って', group: 'godan-u-tsu-ru' }, る: { te: 'って', group: 'godan-u-tsu-ru' },
  む: { te: 'んで', group: 'godan-mu-bu-nu' }, ぶ: { te: 'んで', group: 'godan-mu-bu-nu' }, ぬ: { te: 'んで', group: 'godan-mu-bu-nu' },
  く: { te: 'いて', group: 'godan-ku' }, ぐ: { te: 'いで', group: 'godan-gu' }, す: { te: 'して', group: 'godan-su' },
};
/** Honorific godan verbs: their ます-stem is irregular (ください), so they're left out of drills. */
const HONORIFIC = /(下さる|くださる|おっしゃる|仰る|いらっしゃる|なさる|ござる)$/;

/** Replaces the last `drop` characters of both spellings with the given endings. */
function swap(v: Verb, drop: number, written: string, kana = written) {
  return { written: v.content.slice(0, -drop) + written, kana: v.reading.slice(0, -drop) + kana };
}

/**
 * The verb in the given form, with the ending group it belongs to for that form. Null when the
 * verb can't be drilled: a headword that isn't a dictionary form (行きます, いらっしゃいませ), an
 * honorific godan verb, a one-kanji する verb, an irregular that isn't する or 来る, or a headword
 * whose last kana doesn't match its reading.
 */
export function conjugate(v: Verb, form: VerbForm): Conjugated | null {
  const last = v.reading.slice(-1);
  if (!(last in I_ROW) || v.content.slice(-1) !== last || HONORIFIC.test(v.content)) return null;
  if (v.content.endsWith('ます')) return null; // polite headword (行きます): ends in す, but isn't a す verb (増す is)
  // One kanji + する (愛する, 訳する) partly conjugates like a godan す verb (愛さない), so no drill.
  if (/^\p{Script=Han}する$/u.test(v.content)) return null;

  // A godan verb can end in する too (こする, 擦る), so the type decides.
  if (v.conjugationType !== 'godan' && v.reading.endsWith('する') && v.content.endsWith('する')) {
    const ends = { masu: 'し', te: 'して', ta: 'した', nai: 'しない' };
    return { group: 'suru', ...swap(v, 2, ends[form]) };
  }
  // 来る and its compounds (持って来る); in kana only bare くる, since めくる is godan.
  if ((v.content.endsWith('来る') && v.reading.endsWith('くる')) || v.content === 'くる') {
    const kana = { masu: 'き', te: 'きて', ta: 'きた', nai: 'こない' }[form];
    const written = v.content.endsWith('来る') ? '来' + kana.slice(1) : kana;
    // 来る: the kanji stays, only its reading changes; drop 来る (2 chars) / くる (2 chars).
    return { group: 'kuru', written: v.content.slice(0, -2) + written, kana: v.reading.slice(0, -2) + kana };
  }

  if (v.conjugationType === 'ichidan') {
    if (last !== 'る') return null;
    const ends = { masu: '', te: 'て', ta: 'た', nai: 'ない' };
    return { group: 'ichidan', ...swap(v, 1, ends[form]) };
  }
  if (v.conjugationType !== 'godan') return null;

  if (form === 'masu') return { group: 'godan', ...swap(v, 1, I_ROW[last]) };
  if (form === 'nai') {
    if (v.reading === 'ある') return { group: 'aru', written: 'ない', kana: 'ない' };
    return { group: last === 'う' ? 'godan-u' : 'godan-other', ...swap(v, 1, A_ROW[last] + 'ない') };
  }
  // て / た: 行く is the one godan exception (行いて would be the rule).
  const isIku = v.reading.endsWith('いく') && /(行く|いく)$/.test(v.content);
  const { te, group } = isIku ? { te: 'って', group: 'iku' } : TE[last];
  const ending = form === 'te' ? te : te.slice(0, -1) + (te.endsWith('で') ? 'だ' : 'た');
  return { group, ...swap(v, 1, ending) };
}
