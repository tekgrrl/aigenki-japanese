import { conjugate, patternTails, slotForms, skillId, parseSkillId, FORM_GROUPS, ALL_VERB_FORM_SKILLS, Verb, VerbForm } from './verb-forms';

const v = (content: string, reading: string, conjugationType: Verb['conjugationType']): Verb => ({ content, reading, conjugationType });
const form = (verb: Verb, f: VerbForm) => conjugate(verb, f);

describe('conjugate', () => {
  it.each([
    // [verb, form, group, written, kana]
    [v('食べる', 'たべる', 'ichidan'), 'masu', 'ichidan', '食べ', 'たべ'],
    [v('食べる', 'たべる', 'ichidan'), 'te', 'ichidan', '食べて', 'たべて'],
    [v('食べる', 'たべる', 'ichidan'), 'ta', 'ichidan', '食べた', 'たべた'],
    [v('食べる', 'たべる', 'ichidan'), 'nai', 'ichidan', '食べない', 'たべない'],
    [v('気を付ける', 'きをつける', 'ichidan'), 'te', 'ichidan', '気を付けて', 'きをつけて'],

    [v('買う', 'かう', 'godan'), 'te', 'godan-u-tsu-ru', '買って', 'かって'],
    [v('待つ', 'まつ', 'godan'), 'te', 'godan-u-tsu-ru', '待って', 'まって'],
    [v('帰る', 'かえる', 'godan'), 'te', 'godan-u-tsu-ru', '帰って', 'かえって'],
    [v('飲む', 'のむ', 'godan'), 'te', 'godan-mu-bu-nu', '飲んで', 'のんで'],
    [v('選ぶ', 'えらぶ', 'godan'), 'te', 'godan-mu-bu-nu', '選んで', 'えらんで'],
    [v('死ぬ', 'しぬ', 'godan'), 'te', 'godan-mu-bu-nu', '死んで', 'しんで'],
    [v('書く', 'かく', 'godan'), 'te', 'godan-ku', '書いて', 'かいて'],
    [v('泳ぐ', 'およぐ', 'godan'), 'te', 'godan-gu', '泳いで', 'およいで'],
    [v('話す', 'はなす', 'godan'), 'te', 'godan-su', '話して', 'はなして'],
    [v('行く', 'いく', 'godan'), 'te', 'iku', '行って', 'いって'],

    [v('待つ', 'まつ', 'godan'), 'ta', 'godan-u-tsu-ru', '待った', 'まった'],
    [v('飲む', 'のむ', 'godan'), 'ta', 'godan-mu-bu-nu', '飲んだ', 'のんだ'],
    [v('書く', 'かく', 'godan'), 'ta', 'godan-ku', '書いた', 'かいた'],
    [v('泳ぐ', 'およぐ', 'godan'), 'ta', 'godan-gu', '泳いだ', 'およいだ'],
    [v('話す', 'はなす', 'godan'), 'ta', 'godan-su', '話した', 'はなした'],
    [v('行く', 'いく', 'godan'), 'ta', 'iku', '行った', 'いった'],

    [v('待つ', 'まつ', 'godan'), 'masu', 'godan', '待ち', 'まち'],
    [v('増す', 'ます', 'godan'), 'masu', 'godan', '増し', 'まし'],
    [v('泳ぐ', 'およぐ', 'godan'), 'masu', 'godan', '泳ぎ', 'およぎ'],

    [v('買う', 'かう', 'godan'), 'nai', 'godan-u', '買わない', 'かわない'],
    [v('待つ', 'まつ', 'godan'), 'nai', 'godan-other', '待たない', 'またない'],
    [v('帰る', 'かえる', 'godan'), 'nai', 'godan-other', '帰らない', 'かえらない'],
    [v('ある', 'ある', 'godan'), 'nai', 'aru', 'ない', 'ない'],

    [v('する', 'する', 'irregular'), 'te', 'suru', 'して', 'して'],
    [v('勉強する', 'べんきょうする', 'irregular'), 'nai', 'suru', '勉強しない', 'べんきょうしない'],
    [v('来る', 'くる', 'irregular'), 'masu', 'kuru', '来', 'き'],
    [v('来る', 'くる', 'irregular'), 'te', 'kuru', '来て', 'きて'],
    [v('来る', 'くる', 'irregular'), 'ta', 'kuru', '来た', 'きた'],
    [v('来る', 'くる', 'irregular'), 'nai', 'kuru', '来ない', 'こない'],
    [v('持って来る', 'もってくる', 'irregular'), 'te', 'kuru', '持って来て', 'もってきて'],
  ] as const)('%o %s → %s %s', (verb, f, group, written, kana) => {
    expect(form(verb, f)).toEqual({ group, written, kana });
  });

  it('treats godan verbs ending in くる or する as godan', () => {
    expect(form(v('めくる', 'めくる', 'godan'), 'te')).toEqual({ group: 'godan-u-tsu-ru', written: 'めくって', kana: 'めくって' });
    expect(form(v('こする', 'こする', 'godan'), 'nai')).toEqual({ group: 'godan-other', written: 'こすらない', kana: 'こすらない' });
  });

  it.each([
    ['polite headword', v('行きます', 'いきます', 'godan')],
    ['set phrase', v('いらっしゃいませ', 'いらっしゃいませ', 'irregular')],
    ['honorific godan', v('下さる', 'くださる', 'godan')],
    ['one-kanji する verb', v('愛する', 'あいする', 'irregular')],
    ['irregular that is not する/来る', v('おねがいします', 'おねがいします', 'irregular')],
    ['headword and reading disagree', v('待つ', 'まと', 'godan')],
    ['ichidan not ending in る', v('書く', 'かく', 'ichidan')],
  ])('refuses a %s', (_label, verb) => {
    expect(form(verb, 'te')).toBeNull();
  });

  it('returns a group the form declares, for every result', () => {
    const verbs = [v('食べる', 'たべる', 'ichidan'), v('買う', 'かう', 'godan'), v('飲む', 'のむ', 'godan'), v('する', 'する', 'irregular'), v('来る', 'くる', 'irregular'), v('ある', 'ある', 'godan'), v('行く', 'いく', 'godan')];
    for (const f of ['masu', 'te', 'ta', 'nai'] as VerbForm[]) {
      for (const verb of verbs) {
        const c = form(verb, f)!;
        expect(FORM_GROUPS[f].map(g => g.id)).toContain(c.group);
      }
    }
  });
});

describe('slotForms', () => {
  it('reads the verb forms from notation, once each, skipping {V-dict}', () => {
    expect(slotForms('{V-te}ください')).toEqual(['te']);
    expect(slotForms('もう + {V-ta} / まだ + {V-nai}')).toEqual(['ta', 'nai']);
    expect(slotForms('{V-te}います / {V-te}いる')).toEqual(['te']);
    expect(slotForms('{V-dict}前に / {N}の前に')).toEqual([]);
    expect(slotForms('Clause + ～時')).toEqual([]);
  });
});

describe('patternTails', () => {
  it.each([
    ['{V-masu}ました', 'masu', ['ました']],
    ['{V-te}ください', 'te', ['ください']],
    ['{V-nai}でください', 'nai', ['でください']],
    ['{V-te}はいけません', 'te', ['はいけません']],
    ['{V-masu}ながら', 'masu', ['ながら']],
    ['{V-te}います / {V-te}いる', 'te', ['います', 'いる']],
    ['{V-ta}後で / {N}の後で / 後で{Cl}', 'ta', ['後で']],
    ['{V-te}、{Cl}', 'te', ['']],
    ['{V-ta}', 'ta', ['']],
    ['もう + {V-ta} / まだ + {V-nai}', 'nai', ['']],
  ] as const)('%s (%s) → %j', (content, form, tails) => {
    expect(patternTails(content, form)).toEqual(tails);
  });
});

describe('skill ids', () => {
  it('round-trips and rejects unknown groups', () => {
    expect(parseSkillId(skillId('te', 'godan-mu-bu-nu'))).toEqual({ form: 'te', group: 'godan-mu-bu-nu' });
    expect(parseSkillId('verb-form:nai:godan-mu-bu-nu')).toBeNull();
    expect(parseSkillId('verb-form:dict:ichidan')).toBeNull();
    expect(ALL_VERB_FORM_SKILLS).toHaveLength(4 + 9 + 9 + 6);
  });
});
