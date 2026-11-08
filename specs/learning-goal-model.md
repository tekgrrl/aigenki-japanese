# Learning goals: every evaluation rolls up to one goal

Design notes from a discussion with the owner, 2026-11-07 to 2026-11-08. Nothing here is built yet.
Unless marked **Proposal**, everything below is the owner's decision.

## The shift

A **learning item** is a Vocab, Grammar, Concept or Kanji KU.

**Today**, an item has many independent learning goals: each review card (facet) has its own SRS stage
and its own due time. A Vocab word enrolled in full has a Content-to-Definition card, a
Definition-to-Content card, a reading card, an audio card, an AI question card and so on. They move up
and down separately, so the system tracks "knows the meaning when shown the word", "can answer an AI
question about it" and so on as if they were separate things to learn.

**The new model**: every evaluation rolls up to a **specific learning goal**. Different kinds of question
are different ways of *proving* the same knowledge, not separate goals with their own schedules.

An item can still have **more than one learning goal**, but a goal is a competency, never a question
type. "Answer an AI question" is not a goal; it's one way of proving one. The goals will move towards:

1. **Do they understand how to use it?**
2. **Do they understand how to say it?**
3. **Do they understand it when they hear it?**

We're not there yet. The first goal to move to this model is a Vocab word's meanings: **"does the
learner understand this word and its usages?"**, the start of goal 1.

**Proposal** (how today's cards might map, to be decided as each goal is designed):

| Goal | Evidence that could feed it |
|---|---|
| How to use it | the meaning card: bare word and AI questions (this doc) |
| How to say it | the reading card; later, spoken answers (#298) |
| When they hear it | audio cards, picture cards |

This takes away the old flow where the learner opened a lesson and chose what to learn and how (the
facet checklist on `/learn/[kuId]`). That's accepted.

How it started: in a review, the owner met a usage of 暗い (unfamiliar with, as in 地理に暗い) that they
didn't know, although they knew 暗い = dark. Today nothing records knowing one usage of a word but not
another. Assessing usages separately has long been the owner's aim.

## The meaning goal for Vocab

### One card, one SRS stage
- SRS stays at the **word** level. Learning a word means learning its meanings.
- Each word has one **meaning card** with one SRS stage and one due time.
- **AI questions have no SRS of their own.** They're another way of answering the meaning card, not a
  separate card.
- When the meaning card is due, it's shown as either:
  - **the bare word** (today's Content-to-Definition): any usage is accepted, or
  - **an AI question for one usage**.

  Which form is shown, and when, is **deferred** to the SRS tuning pass (see below). The model must allow
  both. **Proposal**: an AI question targeting a usage not yet proven at the current stage; or tie the
  form to the SRS stage.

### Proving every usage
- There's **no primary usage**. All of a word's usages are equal.
- A correct answer is matched to a usage (see *Answer checking*), and the card records that usage as
  proven at its current stage. This tracking lives with the card and is **not part of SRS**.
- The card moves **up a stage only once every usage has been proven**. The record then resets for the
  next stage. At higher stages, a 3-usage word needs at least 3 correct answers per stage.
- A correct answer that doesn't complete the set follows the **standard SRS pattern**: nothing about SRS
  changes (it comes back at the current stage's interval, without moving up).
- A correct AI question for a usage counts exactly as a correct bare-word answer for that usage.

### Wrong answers
- A wrong answer can't be tied to a usage. A learner trying to think of a *different* usage shouldn't be
  penalised for it.
- So a wrong answer **counts as a normal SRS fail only when no usage has been proven yet at the current
  stage**. Once at least one usage is proven at this stage, wrong answers while searching for another
  have no SRS effect.
- The same rule applies to both forms: bare word and AI question.

### Answering the same usage every time
Stopping the learner from always giving the usage they know best isn't architectural, so it's
**deferred**. The owner's idea: interpose "You've already answered with this usage, can you think of
another?".

## Usages

### Where usages live
- **Lessons stay as they are**: one per KU, covering the word's main usages, never regenerated for this.
- Usages are stored on the lesson, each with a **stable ID**. A label is no longer a usage's identity, so
  editing or relabelling a usage doesn't orphan anything.
- Each usage has a **literal answer** and an **array of accepted answers**:

  ```
  lesson.usages: [
    { id, label: "unfamiliar with / ignorant of",
      meaning: "unfamiliar with",             // the literal answer
      acceptedAnswers: ["ignorant of", ...] }
  ]
  lesson.context_examples[].usageId           // Proposal: each example points at its usage
  ```

- The per-user record of proven usages lives with the meaning card. There's no per-usage map on the
  UKU: the lesson's usage IDs define what a full set is. (This replaces an earlier decision to put a
  dense usage map on the UKU.)

### The usage set comes from labelling
- A word's usages are produced by the **usage labelling step**, which must be good. Definitions feed into
  it, but don't each become a usage.
- Today's prompt (`buildUsageLabelMessage`) only returns one label per example, so it needs replacing.
  **Proposal**: the new prompt
  1. returns a list of usages, each with a label, a literal `meaning` and seed `acceptedAnswers`, and
     points each example at its usage;
  2. accounts for every definition: folds it into a usage (e.g. 暗い's "dark" and "dark, gloomy, dim"
     become one usage) or records it as set aside;
  3. folds a definition that has no example (掛ける's "put on (glasses)", "spend (time)") into the
     nearest usage, or sets it aside, recording which so an admin can see it;
  4. writes `meaning` and `acceptedAnswers` as short glosses a learner would actually type.
- New lessons need the same output at generation time.
- **Proposal**: try the new prompt on the 38 multi-usage lessons first, and check 暗い, 掛ける and a few
  others by hand before running it on the rest.

The data on 2026-11-08: 333 Vocab lessons, 104 with usage labels, 38 with more than one usage. Only 10
have exactly one definition per usage (暗い: 4 definitions, 3 usages; 掛ける: 6 definitions, 4 usages).

### Answer checking
1. The answer is checked **locally** against every usage's `meaning` and `acceptedAnswers`. A match
   identifies the usage.
2. Otherwise it goes to the **AI**, with the list of valid usages. The AI answers as normal, and also
   says **which usage** the answer matched (this can be fuzzy).
3. An answer the AI accepts that isn't in that usage's set yet is **added** to its `acceptedAnswers`, so
   the next attempt matches locally.

### AI questions
- AI questions must be **specific to a usage**. Today they aren't: `QuestionsService.generateVocabQuestion`
  gives the prompt only the word, its reading and the KU's single `data.definition`, and questions are
  stored per word with no usage.
- **Proposal**: generate a question for one usage (its `meaning` and example sentence), and store the
  `usageId` on the question so questions are kept and reused per usage.

## Other cards

- **Reading card**: one per word, the same for all usages. It keeps its own SRS for now.
- **Picture cards**: specific to a usage (掛ける has all 4 usages pictured).
- **Audio cards**: go by the sentence, which fixes the usage. Some text should probably be added to the
  card (what text isn't decided).
- **Whether audio and picture cards also feed the meaning goal**, or keep their own SRS as a listening
  skill: **pinned**. It should be done, but it makes things overly complicated for now.
- **Definition-to-Content: pinned.** It's a different problem: the learner can give a completely
  different word, the AI accepts it, and the original word's SRS still goes up.

## Existing data

Existing user accounts don't constrain the design. They can be scrapped, or one account that works well
can be migrated by a script.

## Deferred and pinned

| Item | Status |
|---|---|
| Which form the meaning card takes when due | Deferred to the SRS tuning pass |
| Nudging the learner towards usages they haven't given | Deferred to the SRS tuning pass; idea: "can you think of another?" |
| How the learner says "I don't know this usage" | Parked |
| Scenarios and other "known word" gates | Parked |
| Audio and picture cards feeding the meaning goal | Pinned |
| Definition-to-Content | Pinned |
| The text to add to audio cards | Not decided |
| Applying the model to Grammar, Concept and Kanji | Not discussed |

## Open questions

- **Mapping today's cards to the three goals.** The table under *The shift* is a proposal. Each goal's
  evidence, and whether audio and picture cards prove usages for goal 1 as well as listening for goal 3,
  is decided as that goal is designed.
- **SRS tuning.** Once this is built, the SRS will be tuned to make the best use of it, including
  nudging the learner towards other usages. Not designed yet.

## Related
- `DATA-MODEL.md`: today's facets, UKUs, lessons and pictures.
- `REVIEW-NOTES.md`: agreed decisions reviewers mustn't re-raise.
- Aside (not scoped): very general verbs such as かける deserve their own grammar point.
