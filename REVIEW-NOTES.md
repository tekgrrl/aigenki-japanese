# Review notes: agreed decisions

Code reviewers (the Gemini PR reviewer and Claude's `/code-review`): these decisions
were made deliberately, with the owner. **Don't raise them as findings.** Raise one only
if a change actually breaks the stated intent. New decisions get added here as they're made.

## Project-wide
- **Admin-only endpoints and tools** (anything behind `AdminGuard`, the `/admin/*` pages): don't
  flag redundant reads, sequential awaits or other performance costs. They're used by one
  person, occasionally.
- **Multi-step Firestore writes without a transaction** in admin/reset flows (`resetSequence`,
  `returnToLessonsAsAudioFirst`) are accepted, as are `stats.reviewForecast`/`hourlyForecast` not
  being adjusted when facets are deleted. The forecast is a cache.
- **Failing stub specs** (`*.controller.spec.ts`, `*.service.spec.ts` "should be defined" with no
  providers) fail on `main` too. They aren't regressions from the PR under review.

## Kanji and lessons
- **Kanji Alive lookups** (`KanjiService.getKanjiAliveMeanings`): failures are deliberately **not**
  cached, so a transient RapidAPI error isn't locked in until restart. A kanji Kanji Alive doesn't
  know comes back as an OK response with no meaning, which *is* cached as `[]`. There's **no Gemini
  fallback**: AIGENKI doesn't generate kanji meanings.
- **Stray component kanji** are removed when a lesson is **read** (`dropStrayComponentKanji`), not
  by a data migration. Saving such a lesson in the admin editor writes the filtered list back,
  which is accepted.
- **Corpus data drift** (`lesson.vocab` vs KU content, missing `kanaOnly`) is fixed by hand as one-off
  data. It's re-audited when the Vocab corpus reaches 800+, and code safeguards are added only then.

## Start Learning and audio-first
- **When items are waiting** (user-knowledge-unit `status: 'learning'` with no facets), Start
  Learning serves **only** those, at most 10 per session, oldest first, with **no** grammar/vocab
  quotas and no pictured-word priority. That's the owner's spec. The quota mix applies only when
  nothing is waiting.
- `returnToLessonsAsAudioFirst` writes `status: 'learning'` **explicitly**, even though
  `recomputeAndCache` derives the same value straight afterwards. That's intentional, so the intent
  is stated rather than left to a side effect.
- **Whole-KU pictures** (`subject.kind: 'ku'`) aren't shown to learners anywhere yet, and don't count
  for audio-first. That's intentional for now; the admin UI says so.

## Scenarios and Flash cards
- **The Role Play gate** (every Key Vocabulary and Key Grammar item at SRS stage 3 or above) applies to
  **all** scenarios, not only those started from a Flash card chain.
- A scenario that already has `vocabReady: true` stored **keeps it**, even if it wouldn't pass the
  stricter stage-3 gate today. It isn't recomputed downwards.
- A **seen Flash card** (scenario opened, or "Not now") is hidden for 8h (the first SRS interval), then
  comes back if its step still isn't done. The scenario itself is never a must-do.
- **A chain starts on promotion** to SRS stage 3 or above, not on every pass. Every learner is promoted
  through stage 3, so a point flagged `scenarioReady` during curation always gets its chain. A point
  flagged *after* a learner passed stage 3 waits for that learner's next promotion. That's accepted.
- **A deleted scenario is regenerated** (a new Gemini run) the next time its grammar point is promoted.
  That's accepted.
- **Flash card cost on small numbers is accepted:** `sync()` handles cards one at a time before due
  reviews are fetched; `start()` repeats a few reads on later promotions after a chain has finished;
  the scenario page counts gate items itself (it may count a duplicated item twice; the backend's
  `ready` decides the button).
