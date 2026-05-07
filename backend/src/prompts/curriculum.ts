import { FunctionDeclaration, Type } from '@google/genai';

export type JlptLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1';

export const JLPT_LEVEL_ORDER: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1'];

// Grammar points introduced at each level. getCumulativeGrammar() stacks these.
const GRAMMAR_ADDITIONS: Record<JlptLevel, string[]> = {
  N5: [
    'Core particles: は、が、を、に、で、へ、も、と、から、まで',
    'Polite present/past/negative: 〜ます、〜ません、〜ました、〜ませんでした',
    'Plain forms: dictionary, ない-form, た-form, なかった-form',
    'い-adjective and な-adjective conjugation (present/past/negative)',
    'Demonstratives: これ/それ/あれ、ここ/そこ/あそこ',
    'Numbers, counters, time expressions',
    'Possession and noun-modification: の',
    'て-form basics: 〜てください、〜ています、〜てもいいですか',
    'Want to: 〜たい / 〜たくない',
    'Question words: なに、だれ、どこ、いつ、どう、なぜ',
    'Sentence-final particles: か (question)、よ (assertion)、ね (agreement)',
    'Copula: です / じゃないです / でした',
    'Existence: あります / います',
    'Direction and goal: 〜に行く / 〜に来る',
  ],
  N4: [
    'Potential form: 〜られる / 〜できる',
    'Passive form: 〜られる',
    'Causative form: 〜させる',
    'て-form chaining for sequential and simultaneous actions',
    'Conditionals: 〜たら、〜ば、〜と',
    'Volitional: 〜よう / 〜ましょう',
    'Progressive / resultant state: 〜ている',
    'Experience: 〜たことがある',
    'Obligation: 〜なければならない / 〜なくてはいけない',
    'Permission / prohibition: 〜てもいい / 〜てはいけない',
    'Purpose: 〜ために',
    'Named / called: 〜という',
    'Hearsay / appearance: 〜らしい、〜そうだ',
    'Simultaneous actions: 〜ながら',
    'Before / after: 〜まえに / 〜あとで',
    'Giving and receiving: あげる、くれる、もらう and て-form compounds',
  ],
  N3: [
    'Completion / regret: 〜てしまう',
    'Do in advance: 〜ておく',
    'Try doing: 〜てみる',
    'Directional aspect: 〜てくる / 〜ていく',
    'Causative-passive: 〜させられる',
    'Strive toward / come to: 〜ようにする / 〜ようになる',
    'Decision / outcome: 〜ことにする / 〜ことになる',
    'Expectation: 〜はずだ / 〜はずがない',
    'Ought to: 〜べきだ',
    'Might: 〜かもしれない',
    'Probability: 〜でしょう',
    'In case of: 〜場合は',
    'Noun-modifying (relative) clauses',
    'Despite / for the purpose of: 〜のに',
    'As soon as: 〜たとたん',
    'While (contrast): 〜一方で',
  ],
  N2: [
    'Resultant state: 〜てある',
    'Despite: 〜にもかかわらず',
    'Towards / regarding: 〜に対して',
    'Depending on / by means of: 〜によって',
    'In / at (formal): 〜において',
    'As / in the capacity of: 〜として',
    'As / following: 〜にしたがって',
    'Although: 〜ものの',
    'That is why: 〜わけだ / 〜わけではない',
    'From the fact that: 〜ことから',
    'No matter how: 〜いくら〜ても',
    'Not only but also: 〜だけでなく〜も',
  ],
  N1: [
    'Literary / classical auxiliary forms',
    'Highly formal written patterns: 〜に際して、〜をもって、〜を踏まえて',
    'Nuanced modal auxiliaries: 〜まい、〜ずにはいられない',
    'Complex nominalization and sentence-final noun phrases',
    'Advanced concessive patterns: 〜とはいえ、〜にせよ',
  ],
};

export interface CurriculumLevelEntry {
  level: JlptLevel;
  note: string;
  grammar: string[];
}

/**
 * Returns all grammar the learner has covered up to and including `upToLevel`.
 * Each entry explicitly notes it is additive on top of previous levels.
 */
export function getCumulativeGrammar(upToLevel: JlptLevel): CurriculumLevelEntry[] {
  const idx = JLPT_LEVEL_ORDER.indexOf(upToLevel);
  return JLPT_LEVEL_ORDER.slice(0, idx + 1).map((level, i) => ({
    level,
    note: i === 0
      ? 'Foundation — every higher level builds on this and retains all these patterns'
      : `Additive layer on top of ${JLPT_LEVEL_ORDER.slice(0, i).join(' + ')} — all previous grammar still applies`,
    grammar: GRAMMAR_ADDITIONS[level],
  }));
}

export const GET_USER_LEVEL_DECLARATION: FunctionDeclaration = {
  name: 'get_user_level',
  description:
    'Returns the learner\'s current JLPT level and the complete cumulative grammar schema ' +
    'covering everything they have studied up to that level. ' +
    'Call this before writing any question so that surrounding sentence grammar and vocabulary ' +
    'stays within what the learner already knows.',
  parameters: {
    type: Type.OBJECT,
    properties: {},
    required: [],
  },
};

export const GET_GRAMMAR_PATTERNS_DECLARATION: FunctionDeclaration = {
  name: 'get_grammar_patterns',
  description:
    'Returns the available Grammar KUs in the learner pool for a given JLPT level. ' +
    'Call this to see which grammar patterns you can reference. ' +
    'Your grammarMatches MUST only contain kuIds returned by this tool.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      jlptLevel: {
        type: Type.STRING,
        description: 'JLPT level to query (e.g. "N4"). Returns patterns at that level.',
      },
    },
    required: ['jlptLevel'],
  },
};
