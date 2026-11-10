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
- **Facet ownership for the admin account** (`user_default`): its facets live in the shared top-level
  `review-facets` collection, which is empty today. `FacetStore` filters reads by `userId` (`query()`,
  `get()`) and the SRS transaction checks `belongsTo`; plain `doc()` writes elsewhere aren't
  re-checked, and admin facets without a `userId` tag are deliberately not supported. Don't flag either.
- **Failing stub specs** (`*.controller.spec.ts`, `*.service.spec.ts` "should be defined" with no
  providers) fail on `main` too. They aren't regressions from the PR under review.

## Profile gate
- **The local dev bypass skips the profile gate** (`FirebaseAuthGuard`, no Bearer token / `user_default`),
  and so does `NEXT_PUBLIC_DEV_SKIP_AUTH` on the frontend. Real tokens in dev are gated.
- **Saving the level recomputes `aboveLevel` and allowed grammar only.** `frontierVocab` / `leechVocab`
  aren't recomputed: they're transient lists that refresh as reviews happen.
- **An enrolment made in the same instant as a level change** can still write an `aboveLevel` flag
  based on the old level (its background write lands after the recompute). Two actions within
  milliseconds; accepted.
- **The dashboard's per-level enrolment counts and curriculum node aren't rebuilt on a level change**
  (`recordKuEnrolled` / `updateCurriculumNode`). They're caches, like the forecasts.
- **The complete-profile cache** (`UserService.knownComplete`) is in memory and per instance. It only
  ever holds uids whose level is stored, and the API can't clear a level. A script or console edit that
  deletes or resets a user doc behind the API's back leaves it stale until the backend restarts; accepted.
- **`LevelSyncService` runs one level sync at a time per account with an in-memory chain**, so it
  serialises within one backend process only. Revisit if the backend ever runs several instances.

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

## Lessons shown to learners
- **Lessons are shown as the Start Learning slides, all on one page** (the lesson page, the Review Lesson
  panel and the library lesson page; the owner's decision). So a Vocab lesson shows one example per
  usage, not every example, and a Grammar point shows no "where you met it" card. That's intended.
  (The slides do include the Vocab reading explanation and the Kanji radical and meaning mnemonic.)
- **In the stacked view nothing plays by itself**: every slide opens at once, so the learner taps play.
- **`user-grammar-lessons` is written but unread** (kept for a future "where you met it" card).
- **Learners can't edit lessons or choose their card types.** The per-user overlay (`user-lessons`) is
  retired, and the old docs are left in place, unread.

## Start Learning and audio-first
- **When items are waiting** (user-knowledge-unit `status: 'learning'` with no facets), Start
  Learning serves **only** those, at most 10 per session, oldest first, with **no** grammar/vocab
  quotas and no pictured-word priority. That's the owner's spec. The quota mix applies only when
  nothing is waiting.
- **The quota mix offers only new items.** A KU the user has a UKU for is never offered there, even
  with no facets: a UKU that isn't `learning` and has no facets is a stale record (e.g. facets deleted
  by hand), not a lesson. The old "enrolled but not started" path that served those was removed.
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

## Reviews
- **Opening Review Lesson before answering** locks the card for this round: only Skip is left. A skipped
  card stays due, so reloading the page or clicking the Review tab brings it straight back, unlocked.
  That's accepted; the cost is deliberately light.
- **Existing reading cards for words without kanji** (Content-to-Reading on katakana words, made
  before the no-kanji rule) are left alone, not deleted by a migration. Only new cards are stopped.

## Vocab usages and the meaning card
- **The usage set is what the lesson's examples show.** Definitions no example shows are set aside, not
  turned into usages, and missing senses are added by hand later. Accepted by the owner, including words
  whose grouping was inherited from older labels.
- **The meaning card's form rule is a placeholder** (AI question from SRS stage 4 for an unproven usage,
  chosen at random). The real rule is deferred to an SRS tuning pass; don't flag the threshold.
- **A correct answer that matches no usage** (the AI passes a real sense that isn't a usage) holds the
  card at its stage. For a one-usage word any correct answer promotes, as before.
- **Existing Vocab `AI-Generated-Question` facets** on current accounts keep their own SRS. Accounts are
  being scrapped or migrated by script, so there's no data migration.
- **Regenerating a Vocab lesson gives its usages new ids** (`set()` replaces the doc). Admin-only and
  rare, and a regenerated lesson has new examples anyway; cards only lose that stage's proven usages
  and questions get regenerated. Accepted.
- **The Meanings list shows each usage's meaning and label, not its accepted answers** (the owner's
  choice); accepted glosses still pass in reviews.
- **AI-accepted answers are written onto the global lesson's usage** (`addUsageAnswer`), an agreed
  exception to "global data changes only via the admin dashboard": it's the owner's design, so the
  next attempt matches locally. AI questions already store accepted alternatives on the shared
  Question doc. Forgiven misspellings are never stored.
- **A wrong meaning-card answer after a usage is proven** ("free fail") keeps the stage and the proven
  usages but reschedules at the stage's normal interval (the owner's choice), so the card doesn't come
  straight back. Stats forecasts aren't adjusted for it (they're a cache).

