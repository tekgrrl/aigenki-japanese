# AISRS-Japanese Architecture

This document describes the high-level architecture of the AISRS-Japanese project.

## Overview
AISRS-Japanese is a bilingual Language Learning app utilizing AI (Google Gemini) to generate comprehensive lessons and reviews tailored to the user's progress. 

The application is built on a split architectural model:
- **Frontend** (`/frontend` folder): A Next.js 15 app router application providing the UI.
- **Backend** (`/backend` folder): A NestJS REST API server handling all business logic, DB interactions, and third-party API calls.
- **Database**: Firebase Firestore.
- **AI Brain**: Google Gemini via `@google/genai` (used extensively in the `/backend/src/gemini` and `/backend/src/lessons` modules).

**Note**: We've failed so far in attempts to convert the app into a monorepo. Eventually we will need to complete this task

## Design Principles
1. **Separation of Concerns**: The frontend is strictly a view layer containing UI components, React state, and data-fetching hooks. The backend is the definitive source of truth and the only service allowed to connect directly to the database.
2. **AI-First Generation**: Content is dynamically generated using the current model (Gemini 3.0 Flash Preview) instead of relying on pre-authored datasets. Knowledge Units (KUs), lessons, and review-facets are distinct entity types, each having its own document, and are assembled just-in-time.
3. **Database Workflow**: For local development, the backend handles all database interactions. You can optionally use the Firestore Emulator (`localhost:8080`) for testing.

## Functional Requirements
The system has three main learning mechanisms currently: 

1. Vocab/Grammar Lessons
2. Concepts 
3. Scenarios

Each of these has it's own, **built-in learning mechanism** and each can generate what we'll call **Drills** via the Reviews Service.   
Scenarios and Concepts can also generate Vocab/Grammar lessons (a level of indirection) which can then generate drills via the Reviews Servce.
## Data and Types

### Types
Backend and Frontend are effectively separate components that communicate via REST API.  Aim is to one day convert to a monorepo. Each component has it's own type definitions file located in `<component>/src/types/index.ts`, they should basically be the same but can get our of sync. The types have developed over time on the basis that there is a single user using the system. Plumbing for users has been added but is not actually used in anyway other than to provide a default auth token for use in authenticating calls to the backend. We tried to separate the "Global" data from user specific data but the AI made some poor choices.

### Data
Basic Vocab data was extracted from Wanikani and then boiled down to non-proprietary data including content/slug, reading, meaning and wanikani level. These data have been bulk added to the `knowledge-units` collection in Firestore.

## Component Responsibilities

### Frontend (`/frontend`)
- **Framework**: Next.js 15+, React 19, TypeScript, Tailwind CSS v4.
- **Core App**: Built around `/src/app/learn`, `/src/app/review`, `/src/app/manage`, and `/src/app/scenarios`.
- **API Interaction**: The frontend natively queries the backend endpoint (`http://localhost:3500`). It does **not** query Firestore directly. Next.js server-side features are minimized in favor of the specialized NestJS backend.
- **State Synchonization**: Uses lightweight approaches like dispatching custom client-side events (e.g., `refreshStats`) that components listen to and respond by re-fetching data via their hooks.

### Backend (`/backend`)
- **Framework**: NestJS 10+, TypeScript.
- **Module Structure (Core):**
  - **`knowledge-units`**: CRUD operations and schema logic for KUs.
  - **`review-facets`**: Logic handling the Spaced Repetition System (SRS). Converts learning queue items to review queues using `nextReviewAt` timestamp filtering.
  - **`lessons`**: Assembles Prompts, queries Gemini, and translates the structured JSON or text back to the client.
  - **`scenarios`**: Complex logic handling multi-turn roleplay conversations, evaluations, and state machines mapping encountering new phrases to learning loops.
  - **`concepts`**: Generates and stores `ConceptKnowledgeUnit` documents (grammar concept pages) via `GeminiService.generateConcept`. Uses a dedicated `GEMINI_MODEL` env var so a higher-capability model can be used independently of the flash model used elsewhere.
  - **`stats`**: Central endpoint for aggregating dashboard/queue numbers.
- **Database Access**: Uses `firebase-admin` natively (not via Web SDK). Note: Next.js API Routes must not use `firebase-admin`; thus, all such operations are fully isolated in this NestJS layer.
- **Gemini**: Relies heavily on high-context, single prompt instructions using the current model (`gemini-3-flash-preview`) rather than generic `systemInstruction` prompts.

## Development Setup
- **Node/Package**: Uses `yarn` workspaces or separated `yarn` installs in each folder depending on CI config. DO NOT USE `npm`.
- **Running Locally**:
  - Frontend: Runs on `http://localhost:3000` (`yarn dev` inside `/frontend`)
  - Backend: Runs on `http://localhost:3500` (`yarn start:dev` inside `/backend`)
  - Firestore Emulator (Optional for testing): Runs on `http://localhost:8080` (usually launched via root `firebase emulators:start`)

## ToDo

### Manage page
- Add JLPT badges and Wanikani level badges to the listings for each Vocab
- Add a way to filter by JLPT level and Wanikani level
- **Meta requirement**: The manage page should eventually be just and admin function and not a list of the Vocab the User has in their learning or review queues or in their overall user context (if we go down that route). This requires a lot of other work to be done first.

### Interactive Parsing & Scoping Units

**Context**: The standard `ConceptKnowledgeUnit` is optimised for atomic rule introduction (e.g., adjectival clauses). It is insufficient for teaching the dynamic skill of untangling complex, ambiguous scoping in longer sentences — e.g., identifying exactly which verb or noun an adverb like あそこで modifies.

**Proposed Architecture**: Introduce a dedicated `ParsingKnowledgeUnit` designed purely for interactive reading comprehension and relationship mapping, used within scenarios.

#### 1. Data Schema

```typescript
export interface ParsingKnowledgeUnit extends KnowledgeUnitBase {
  type: "Parsing";
  data: {
    context: string;          // Brief situational setup
    sentence: {
      japanese: string;       // The complex/ambiguous sentence
      english: string;        // Full translation
    };
    targetPhrase: string;     // The ambiguous modifier (e.g., "あそこで")
    correctTarget: string;    // What it actually modifies (e.g., "読んでいる")
    distractorTarget: string; // The plausible but wrong target (e.g., "人")
    explanation: string;      // Diagnostic feedback explaining the boundary logic
  };
}
```

#### 2. UI/UX Interaction

- **Presentation**: Render the Japanese sentence and visually highlight the `targetPhrase`.
- **Interaction**: Prompt the user to identify the scoping boundary (e.g., "Tap the exact word or phrase that [targetPhrase] modifies").
- **Feedback**: Correct selection confirms the mental model. Selecting the `distractorTarget` (or elsewhere) reveals the `explanation` diagnostic to correct the user's understanding of the sentence structure.

#### 3. Generation Pipeline (Gemini)

Create a new pipeline in `ConceptsService` to generate these units. Instruct the LLM to:
- Generate Japanese sentences with intentional modifier ambiguity.
- Explicitly isolate the `targetPhrase`, `correctTarget`, and a highly plausible `distractorTarget`.
- Provide pedagogical explanations focused on why the syntax dictates one relationship over the other.

---

### Users
- (Done) Global KU data is stored in the `knowledge-units` collection in Firestore, accessed via the `knowledge-units` service. The service is now user-agnostic — no `userId` filtering on reads, no `userId` written to new documents.
- (Done) User KU metadata is stored in `users/{uid}/user-kus` as `UserKnowledgeUnit` documents referencing global KUs via `kuId`. Managed by `UserKnowledgeUnitsService`.
- (Done) Users can sign up and log in via passwordless email-link auth.
- (Done) When a user interacts with a scenario and clicks "Start Drilling", `UserKnowledgeUnit` documents are created in their sub-collection — this populates their Learning Queue.
- (Done) Scenarios migrated from top-level `scenarios` collection to `users/{uid}/scenarios` sub-collection (issue #133).
- (Done) Questions have been overhauled — see **Question Corpus** section below and Migration History.

## User Management, Authentication & Multi-Tenancy

This section documents the current implementation of auth and user scoping so that agents completing the Users ToDo items have a clear baseline to build from.

### Current State Summary

The system is now **multi-tenant**. Real users sign in via passwordless email-link auth and get fully isolated data in Firestore sub-collections. The admin user (`user_default`) retains access to top-level collections for corpus management. The backend guard falls back to `user_default` in dev mode when no token is present.

---

### Authentication Flow

**Frontend → Backend token handoff**

1. `frontend/src/providers/AuthProvider.tsx` — wraps the app. On mount, `onAuthStateChanged` fires; if no session exists it calls `signInAnonymously()`. The resulting Firebase `User` object is stored in React Context.
2. `frontend/src/lib/firebase-client.ts` — initialises the Firebase Web SDK (project `gen-lang-client-0878434798`, env vars `NEXT_PUBLIC_FIREBASE_API_KEY` / `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`). In development it connects to the Firestore Emulator at `localhost:8080`.
3. `frontend/src/lib/api-client.ts` — thin `fetch` wrapper. Before every request it calls `auth.authStateReady()` then `auth.currentUser.getIdToken()` and injects the result as `Authorization: Bearer <token>`. Failures are caught and logged but the request still proceeds (without a token).

**Backend token validation**

`backend/src/auth/firebase-auth.guard.ts` implements `FirebaseAuthGuard`:

- **Development (`NODE_ENV !== 'production'`):**
  - No `Authorization` header → sets `request.user = { uid: 'user_default' }`, returns `true`.
  - Token present but `admin.auth().verifyIdToken()` throws → sets `request.user = { uid: 'user_default' }`, returns `true`.
  - Token valid → sets `request.user = decodedToken` (real Firebase UID).
- **Production (`NODE_ENV === 'production'`):**
  - No header → throws `UnauthorizedException`.
  - Invalid token → throws `UnauthorizedException`.
  - Valid token → sets `request.user = decodedToken`.

`backend/src/auth/user-id.decorator.ts` — `@UserId()` param decorator that reads `request.user?.uid`. Used on every protected controller method.

**Admin/default user**

`backend/src/lib/constants.ts` exports `ADMIN_USER_ID = 'user_default'`. The string `'user_default'` is also hardcoded directly in `firebase-auth.guard.ts` (dev-mode fallback) — a TODO exists in `constants.ts` to consolidate this. The admin user manages the global KU corpus and writes to top-level Firestore collections; all other users write to per-user sub-collections.

---

### Guard Coverage

Every controller applies `@UseGuards(FirebaseAuthGuard)` at the class level:
- `auth.controller.ts`, `user.controller.ts`, `knowledge-units.controller.ts`, `reviews.controller.ts`, `lessons.controller.ts`, `questions.controller.ts`, `stats.controller.ts`, `scenarios.controller.ts`, `kanji.controller.ts`, `concepts.controller.ts`

All service methods accept `uid: string` as their first parameter and use it for Firestore scoping (see below).

---

### Firestore Multi-Tenancy Pattern

Per-user data lives in **Firestore sub-collections** under `users/{uid}/<collection>`. The Firestore Collection Map above reflects the current state.

**Sub-collection routing** — services that touch per-user data use a private `colRef(uid)` helper that routes `ADMIN_USER_ID` (`user_default`) to the legacy top-level collection and everyone else to `users/{uid}/<collection>`. `ReviewsService.facetsColRef` is the canonical reference implementation. See issue #138 for the ongoing work to consolidate duplicate copies of this logic.

**Global collections** (`knowledge-units`, `concepts`, `questions`, `lessons/{kuId}`) have no `userId` on new documents. `createdBy` is used for audit only where present.

**Exceptions still using `userId` field scoping:**
- `lessons` for Vocab/Kanji types — legacy documents still carry a `userId` field (lazy migration: field is deleted on read).
- `api-logs` — no user scoping.

---

### Firestore Collection Map

| Collection | Scoped by userId? | Notes |
|---|---|---|
| `knowledge-units` | **No** | Global corpus — no `userId` on new docs; legacy docs may still have `userId: 'user_default'` |
| `users/{uid}/user-kus` | Yes — sub-collection path | Per-user KU metadata; `kuId` references global KU |
| `users/{uid}/review-facets` | Yes — sub-collection path | Per-user SRS facets (non-admin users) |
| `review-facets` | Yes (field) | Admin (`user_default`) SRS facets only; `userId` field still required |
| `lessons` | **No** | All lesson types stored globally at `lessons/{kuId}` — no `userId`. Legacy Vocab/Kanji docs may still carry a `userId` field; lazily deleted on read. User edits live in `users/{uid}/user-lessons/{kuId}` overlay (merged on read). |
| `users/{uid}/user-lessons` | Yes — sub-collection path | Per-user lesson overrides (`meaning_explanation`, etc.). Written by `updateLesson`; merged on top of the global doc in `generateLesson` and `findByKuId`. |
| `users/{uid}/user-grammar-lessons` | Yes — sub-collection path | Per-user per-encounter `UserGrammarLesson` docs. Doc ID: `{kuId}_{sourceType}_{sourceId}` (deterministic, prevents duplicates per source). |
| `questions` | **No** | Global question corpus — no `userId` on new docs. `rank` and `rejectionCount` fields drive selection. |
| `users/{uid}/question-states` | Yes — sub-collection path | Per-user `UserQuestionState`: `rejected`, `consecutiveFailures`, `kuId` |
| `users/{uid}/scenarios` | Yes — sub-collection path | Roleplay scenario state. Admin (`user_default`) uses root `scenarios` collection. `sourceKuId` field links back to the vocabulary KU that triggered generation from a context example. Requires composite index on `(sourceKuId, createdAt)`. |
| `user-stats` | Yes — doc ID is uid | Legacy stats; `USER_STATS_COLLECTION.doc(uid)` |
| `users` | Yes — doc path `users/{uid}` | `UserRoot` document (stats, tutorContext, preferences) |
| `concepts` | **No** | Global grammar concept corpus — no `userId` on docs; `createdBy` field for audit only |
| `api-logs` | **No** | Centralised logging; no user field |

---

### Key Types

- **`UserRoot`** (`backend/src/types/index.ts` ~line 34) — stored at `users/{uid}`. Contains `stats`, `tutorContext`, and two `preferences` fields: `tutorContext.preferences` (feed tuning — `dailyMaxNew`, `dailyMaxTotal`) and a top-level `preferences` object (`showFurigana: boolean`). Top-level preferences are written via `PATCH /api/users/me/preferences` and read on the `/profile` page.
- **`KnowledgeUnit`** (~line 205) — has `userId` field (marked `@deprecated` as part of future migration to a separate `user-kus` sub-collection). `data` bag holds `jlptLevel`, `wanikaniLevel`, `reading`, `meaning`.
- **`UserKnowledgeUnit`** (~line 235) — intended future shape: user metadata (`status`, `personalNotes`, `facet_count`) pointing at a global KU via `kuId`. **Not yet used in queries.**
- **`ReviewFacet`** (~line 261) — bridges to `KnowledgeUnit` via `kuId`; carries `srsStage` (0–8) and `nextReviewAt`.
- **`QuestionItem`** — global question document. `rank: number` (0–100, starts 50, suitable threshold 30); `rejectionCount: number` (observability only). Deprecated fields (`userId`, `status`, `lastUsed`, `previousAnswers`) may exist on legacy docs but are ignored.
- **`UserQuestionState`** — stored at `users/{uid}/question-states/{questionId}`. `rejected: boolean` (user never sees this question again); `consecutiveFailures: number` (persists across sessions, resets on correct answer, triggers rotation at 3); `kuId` (denormalised for querying).

---

### Environment Variables

**Backend (`backend/.env`)**
```
GOOGLE_CLOUD_PROJECT=gen-lang-client-0878434798   # Firebase project
FIRESTORE_DB=aisrs-japanese-dev                    # Named Firestore database
NODE_ENV                                           # 'production' enables strict auth
MODEL_GEMINI_FLASH=gemini-3-flash-preview          # Default model used by all Gemini methods
GEMINI_MODEL=gemini-3.1-pro-preview                # Higher-capability model used only by generateConcept
```

**Frontend (`frontend/.env.local`)**
```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=gen-lang-client-0878434798.firebaseapp.com
```

---

### What Needs to Be Done (Implementation Guide for Agents)

The following work is required to complete proper multi-user support. Each item builds on the previous.

**1. Replace anonymous auth with real sign-up / sign-in**
- Frontend: add email/password (or Google OAuth) sign-in UI. The `AuthProvider` already handles `onAuthStateChanged`; swap `signInAnonymously()` for the chosen provider.
- Backend: no changes needed — the guard already calls `admin.auth().verifyIdToken()` correctly for real users.

**2. User creation on first login**
- When a new UID is seen for the first time, create a `users/{uid}` document (default `UserRoot`) and seed any required initial state.
- This can live in the `UsersService` (`backend/src/users/user.service.ts`) called from an `onAuthStateChanged` or a dedicated `/users/init` endpoint.

**3. ~~Migrate KU user-data to `users/{uid}/user-kus`~~ — Done**
- `knowledge-units` is now a global corpus with no `userId` on new documents.
- `users/{uid}/user-kus` sub-collection holds per-user KU metadata via `UserKnowledgeUnitsService`.
- `users/{uid}/review-facets` sub-collection holds per-user SRS facets for non-admin users.
- The Learning Queue (`GET /api/knowledge-units/get-all?status=learning`) returns only the user's UKU-joined global KUs.
- `KnowledgeUnitsController.findOne` authorises access via direct ownership (admin) OR existence of a UKU for that `kuId`.

**4. Harden the dev guard bypass**
- The current fallback to `user_default` on any token failure in dev mode is useful but should log a warning so it is obvious when a real token is being silently dropped.
- Consider making the default UID configurable via env var (`DEFAULT_DEV_UID`) so individual developers can test with their own UID against a shared emulator.

**5. Scope `api-logs` by user (optional)**
- Add `userId` field to log documents so per-user activity can be audited.

## Question Corpus

`AI-Generated-Question` facets draw from a **global question corpus** shared across all users for the same KU.

### Selection logic (`QuestionsService.selectQuestion`)
1. If the facet has a `currentQuestionId`, try to reuse it — passes if `rank >= 30`, not rejected by this user, and `consecutiveFailures < 3`.
2. Otherwise query all questions for the KU, apply the same suitability filters, pick the first passing candidate.
3. If no suitable question exists, generate a new one via Gemini and save it to the global corpus.

### Ranking
| Event | `questions/{id}.rank` | `UserQuestionState` |
|---|---|---|
| Correct answer | +5 | `consecutiveFailures = 0` |
| Wrong answer | no change | `consecutiveFailures++` |
| Keep feedback | +5 | — |
| Request New | no change | `rejected = true`; global `rejectionCount++` |
| Report feedback | -25 | — |

Rank nominally 0–100 but is not hard-clamped; `>= 30` is the only gate used in queries.

### Concept KU routing

Before falling through to `generateVocabQuestion`, `generateAndSave` checks whether the `kuId` belongs to a Concept. It first tries `knowledgeUnitsService.findOne` (in case a Concept-typed KU ever lands in `knowledge-units`), then falls back to a direct Firestore read of the `concepts` collection — because `ConceptsService.createFacets` sets `kuId = conceptId`, pointing into `concepts` not `knowledge-units`. If the document exists and has mechanics, a random mechanic is picked and `generateConceptQuestion` is called. Only after both lookups fail does execution fall through to the vocab path.

Concept questions: `buildConceptQuestionPrompt` enforces that the `question` field is written entirely in English; any Japanese sentence shown to the user is embedded as a quoted string within the English instruction.

### Verb vs noun question type branching

`generateVocabQuestion` inspects `meaning` (fetched from the KU) before picking a question type:
- **Verb** (`meaning` starts with `"to "`) → picks randomly from `VOCAB_QUESTION_OPTIONS` (conjugation, particle, translation, fill-in-the-blank).
- **Non-verb** (nouns, adjectives, anything else) → picks randomly from `NOUN_QUESTION_OPTIONS` (noun-particle, translation).

`noun-particle` questions blank out `<noun><particle>` together (e.g. `図書館で`, `歯を`). The `context` field follows the format "Specify [label] as [role]" to uniquely identify the correct particle. `accepted_alternatives` is always empty. `NOUN_PARTICLE_FEW_SHOT_TURNS` (five `{user, model}` pairs) are passed as real conversation turns in `contents` — NOT embedded in the system prompt — because `generateQuestionAI` uses `responseSchema` (controlled generation mode), where JSON in the system instruction is misinterpreted.

`GeminiService.generateQuestionAI` accepts an optional `fewShotTurns?: Array<{ user: string; model: string }>` parameter. When provided, each pair is prepended to `contents` as `role: 'user'` / `role: 'model'` turns before the actual question message.

### Key endpoints
- `GET /api/questions/generate?topic=&facetId=&kuId=` — returns `{ question, answer, context, accepted_alternatives, questionId, isNew }`. `isNew: true` means no `UserQuestionState` exists yet for this user; the frontend uses this to decide whether to show the feedback modal.
- `PATCH /api/questions/:id/feedback` — body `{ feedback: 'keep' | 'request-new' | 'report' }`.

### Migration note for existing question documents
Legacy docs lack `rank` and `rejectionCount`. They are served correctly on first use (`rank ?? 50` at read time) but fall below the suitability threshold after their first correct answer or feedback write (`FieldValue.increment` initialises missing fields from 0). Run a one-time backfill of `{ rank: 50, rejectionCount: 0 }` across the `questions` collection to restore them.

---

## Scenario Progress Tracking

Each `Scenario` document tracks the user's best performance per JLPT level:

```typescript
progress?: Record<string, LevelProgress>  // keyed by ScenarioDifficulty e.g. 'N5'
currentLevelStatus?: ProgressStatus        // denormalised for Firestore queries
```

`ProgressStatus = 'reviewing' | 'failing' | 'passing' | 'passed'` — derived from `bestStars`:
- 0 stars → `reviewing`, 1–2 → `failing`, 3–4 → `passing`, 5 → `passed` (sticky — never regresses)

`LevelProgress` stores `{ status, bestStars, lastAttemptAt, attempts[] }`. Each `Attempt` records `{ attemptedAt, stars: 1|2|3|4|5 }`.

Written in `ScenariosService.writeProgressUpdate` (called from the `advanceState` completed branch after evaluation). Uses Firestore dot-notation (`progress.N5`) so multiple level entries coexist in the map without clobbering.

`currentLevelStatus` mirrors `progress[scenario.difficultyLevel].status` and is written on the same update. Intended for dashboard queries such as `where('currentLevelStatus', '==', 'passing')`.

### Assessment screen tiered messaging

| Stars | Header | Guidance |
|---|---|---|
| 1–2 | "Keep Practising" (red) | Review grammar notes and vocab, retry when ready |
| 3–4 | "Good Effort!" (amber) | Study notes again, come back aiming for 5 stars |
| 5 | "Mission Complete!" (green) | Try next JLPT level from the scenario library |

### `vocabReady` flag

Once all vocab KUs linked to a `drill`-state scenario have `minSrsStage >= 1`, `vocabReady: true` is written to the scenario document.

Trigger: post-transaction block in `ReviewsService.updateFacetSrs` — after a successful SRS stage increment, looks up the UKU by `kuId`; if `uku.source.type === 'scenario'`, calls `ScenariosService.checkAndSetVocabReady(uid, scenarioId)`. That method early-exits if already `true` or `state !== 'drill'`, then uses `getKuStatus` to check all linked KU facets. Errors are caught and logged (non-blocking). Constant `VOCAB_READY_MIN_STAGE = 1` in `scenarios.service.ts`.

Intended use: dashboard queries such as `where('state','==','drill').where('vocabReady','==',true)`. Requires a Firestore composite index on `users/{uid}/scenarios`.

---

## Learning Progress & Mastery

### Design Principle

Learning state for a KU is not a field to be manually managed — it is derived from evidence. `LearningProgressService` is the single service that owns the rules for interpreting that evidence and is the **only** place that may write `UKU.status`. The SRS is the single arbiter of whether a user actually knows something; the service interprets SRS data into a coherent status.

The current `UKU.status` field is a hodge-podge of manually-set values that can drift out of sync with actual facet SRS data. Under this design it becomes a **materialized view** — computed by `LearningProgressService` and cached on the UKU document, never set directly by other services.

---

### LearningProgressService

A dedicated service, separate from `ReviewsService`. `ReviewsService` owns the mechanics (facet CRUD, SRS scheduling, due reviews). `LearningProgressService` owns the *interpretation* of those mechanics.

Responsibilities:
- **Define what each UKU status level means** in terms of facet SRS data
- **Compute and cache `UKU.status`** after every facet creation or SRS update
- **Own the facet creation rules** applied when a user submits the lesson page

Nothing else computes or sets `UKU.status` directly. All status transitions flow through this service.

---

### Lesson Page — "What Do You Already Know?"

The lesson page UX is inverted from the original design. Instead of asking the user what they *want* to learn, it asks what they *already know*.

For each possible review facet, the user makes a binary choice:

| Selection | Meaning | Facet created at |
|---|---|---|
| **Checked** | "I already know this" | Stage N-1 (one below mastered) |
| **Unchecked** | "I need to learn this" | Stage 0 |

Every visible facet gets created — the only difference is the starting stage. A user who checks nothing gets all facets at stage 0 and works through them normally. A user who checks everything self-certifies and the SRS verifies that claim on their next review.

The SRS is the single arbiter. If the user was right, they'll burn through high-stage facets quickly. If they were wrong, they'll fail reviews and fall back into active learning.

**Note:** Kanji component facets follow user selection on the lesson page, but Kanji mastery is not a tracked learning goal and is never gated on. Users may choose to learn Kanji via SRS but it is outside the scope of `LearningProgressService`.

---

### UKU Status Rules

Computed by `LearningProgressService` from facet data. `MASTERED_STAGE` is a named constant (currently 7).

| Status | Condition |
|---|---|
| `learning` | UKU exists; no review facets — appears in learning queue |
| `reviewing` | Has facets; at least one facet below `MASTERED_STAGE` |
| `mastered` | Has facets; all facets at or above `MASTERED_STAGE` |

---

### Scenario vocabReady Gate

The gate threshold remains `minSrsStage >= 1` across all vocab KUs linked to the scenario.

| Facet starting stage | Gate behaviour |
|---|---|
| Stage N-1 (self-certified) | Satisfies gate immediately on creation — scenario unlocks without requiring a review |
| Stage 0 (learning from scratch) | Requires one successful review to reach stage 1 before the gate is satisfied |

A user who claims to know all linked vocab can proceed to roleplay immediately. A user learning from scratch must complete at least one review per KU first.

---

## Migration History

**Note**: This section is very much outdated but should be used to summarize the history of the project. 

Previously, the Next.js `frontend` app hosted Next API Routes (`/src/app/api/...`) that directly connected to a `db.json` and then migrated to Firestore. Those legacy Next.js API endpoints are now deprecated and moved into the `legacy-api/` directory (or removed). The backend is strictly the `/backend` folder.

**Multi-tenant auth implementation (2026-04)**

- Replaced anonymous Firebase sign-in with **passwordless email-link authentication** (`sendSignInLinkToEmail` / `signInWithEmailLink`).
- Added `frontend/src/app/login/page.tsx` — email-only "Send Sign-in Link" form. Shows a confirmation screen after the link is sent. No header rendered on this page.
- Added `frontend/src/app/auth/callback/page.tsx` — landing page for the Firebase email link. Calls `isSignInWithEmailLink` + `signInWithEmailLink` to complete auth. Handles cross-device sign-in (prompts for email if localStorage is empty on a different device).
- Rewrote `frontend/src/providers/AuthProvider.tsx`:
  - `onAuthStateChanged` drives routing. Public paths (`/login`, `/auth/callback`) are accessible without auth; all other routes redirect to `/login`.
  - On successful auth, calls `GET /api/users/me` (idempotent find-or-create) to initialise the `users/{uid}` document.
  - Exposes `signOut()` via `AuthContext`.
- Updated `frontend/src/components/Header.tsx`:
  - Returns `null` when `user` is not set, so no nav chrome appears on public pages.
  - Stats are only fetched after a user is confirmed.
  - Displays truncated user email and a "Sign out" button.
- The backend `FirebaseAuthGuard` dev-mode fallback is extended: when no Bearer token is present it now reads the `X-Dev-User-Id` request header (if set) before falling back to `user_default`. This lets the frontend dev bypass target a specific UID.
- **Dev workflow**: to run the frontend against existing Firestore data without signing in, pass both env vars at start time:
  ```
  NEXT_PUBLIC_DEV_SKIP_AUTH=true NEXT_PUBLIC_DEV_USER_ID=<uid> yarn dev
  ```
  Omit `NEXT_PUBLIC_DEV_USER_ID` to fall back to `user_default`.
**Multi-tenant data isolation (2026-04)**

- **`knowledge-units` made global**: Removed `userId` from all `KnowledgeUnitsService` method signatures and Firestore queries. New KU documents are written without a `userId` field. `KnowledgeUnitsService` is now user-agnostic; `findByContent` absorbs the former `findByContentGlobal`.
- **`UserKnowledgeUnitsService`** added (`backend/src/user-knowledge-units/`): manages `users/{uid}/user-kus` sub-collection. `create(uid, kuId)` is idempotent. `findLearningQueueAsKUs(uid)` batch-joins UKUs with their global KUs for the learning queue endpoint.
- **Scenario → UKU flow**: `ScenariosService.advanceState` (encounter→drill) now creates `UserKnowledgeUnit` records instead of `KnowledgeUnit` records. Vocab not found in the global corpus is skipped with a warning.
- **`review-facets` per-user sub-collection**: `ReviewsService` routes all facet reads/writes to `users/{uid}/review-facets` for non-admin users; `user_default` continues to use the top-level `review-facets` collection with `userId` field scoping. Same routing applied in `StatsService`.
- **`ADMIN_USER_ID` constant**: `CURRENT_USER_ID` renamed to `ADMIN_USER_ID` in `backend/src/lib/constants.ts`. The string `'user_default'` remains hardcoded in `firebase-auth.guard.ts` pending a follow-up cleanup.
- **Frontend**: `refreshStats` event dispatched after successful encounter→drill advance so the Learn tab badge updates immediately.

**Question corpus overhaul (2026-04)**

- Replaced the broken per-facet `questionAttempts` reuse logic with a global question corpus and per-user state model.
- `questions` collection is now user-agnostic (no `userId` on new docs). Added `rank: number` (starts 50) and `rejectionCount: number` fields.
- New `users/{uid}/question-states/{questionId}` sub-collection stores per-user `UserQuestionState` (`rejected`, `consecutiveFailures`, `kuId`).
- `QuestionsService` rewritten: `selectQuestion` (reuse → corpus → generate), `recordAnswer` (rank/failure tracking), `recordFeedback` (keep / request-new / report).
- `PATCH /api/questions/:id` replaced by `PATCH /api/questions/:id/feedback` with `{ feedback }` body.
- `GET /api/questions/generate` now returns `isNew: boolean` instead of `status`; frontend uses it to gate the feedback modal.
- `POST /api/reviews/evaluate` now accepts optional `kuId` and calls `recordAnswer` on every evaluation.
- `ReviewFacet.questionAttempts` deprecated; `updateFacetQuestion` no longer resets it.
- Frontend `review/page.tsx`: `dynamicQuestionStatus` state replaced by `dynamicQuestionIsNew`; `isNewAiQuestion` simplified; feedback handlers call `recordFeedback`.

---

**`sentence-cloze` facet type (2026-04)**

- Added `"sentence-cloze"` to `FacetType` in both `backend/src/types/index.ts` and `frontend/src/types/index.ts`.
- New `frontend/src/components/review/SentenceClozeCard.tsx` — typed fill-in-the-blank card. Renders the sentence with `[____]` replaced by a styled inline blank; wanakana IME input; strict match evaluation against `back.answer` and `back.accepted_alternatives`; reveals `back.fullSentence` on submit.
- Facet `data` shape: `front: { sentenceWithBlank: string, hint: string }`, `back: { answer: string, fullSentence: string, accepted_alternatives?: string[] }`, `goalTitle?: string`.
- `review/page.tsx` updated: renders `SentenceClozeCard` for `sentence-cloze` facets; excluded from the standard review-card form and answer-feedback section.
- Generation (how/when `sentence-cloze` facets are created) is deferred — not yet wired into `ConceptsService.createFacets`.

---

**Grammar types + scenario sentence-assembly facets (2026-04-21)**

- **`GrammarKnowledgeUnit.data`** fully typed in both type files: `{ title: string, explanation: string, exampleInContext: { japanese: string, english: string, fragments: string[], accepted_alternatives: string[] } }`.
- **`GrammarNote`** (both `backend/src/types/scenario.ts` and `frontend/src/types/scenario.ts`) updated to match: `exampleInContext` changed from a flat string to the same structured object.
- **Gemini scenario prompt** (`buildArchitectPrompt`): `grammarNotes` output schema updated to return the structured `exampleInContext` object. Fragment rules added: minimal grammatical chunks, joined in order must reproduce the `japanese` field exactly, no romaji.
- **`ScenariosService.advanceState`** encounter→drill: after linking vocab KUs, now batch-creates one `sentence-assembly` facet per grammar note into `users/{uid}/review-facets`. Facet `kuId = scenario.id`; `data` shape matches the existing `SentenceAssemblyCard` contract (`goalTitle`, `fragments`, `answer`, `english`, `accepted_alternatives`).
- **`SentenceAssemblyCard`**: `concept` prop made optional; "Review concept" link is conditionally rendered. `review/page.tsx` passes `concept` only when `ku.type === 'Concept'`.
- **`scenarios/[id]/page.tsx`**: grammar notes section updated to render `note.exampleInContext.japanese` and `note.exampleInContext.english`.
- Deleted orphaned `scenario-templates` Firestore collection (written by `migrate-v2-architecture.ts` but never read by the app).
- Issue #133 filed: migrate `scenarios` top-level collection to `users/{uid}/scenarios` sub-collection.

---
**Manage page scoped to user KUs (2026-04)**

- **`UserKnowledgeUnitsService.findAllAsKUs(uid)`** added: returns all KUs for a user regardless of status (learning or reviewing), by fetching the full `users/{uid}/user-kus` sub-collection and batch-joining against global `knowledge-units`. The shared join logic was extracted into a private `_joinKUs` helper, which `findLearningQueueAsKUs` also now uses.
- **`KnowledgeUnitsController` (`GET /api/knowledge-units/get-all`)**: added `status=user` branch that routes to `findAllAsKUs(uid)`.
- **`frontend/src/app/manage/page.tsx`**: changed the KU fetch from `/api/knowledge-units/get-all` to `/api/knowledge-units/get-all?status=user` so the Manage tab displays only the authenticated user's KUs instead of the entire global corpus.

**`KnowledgeUnit` refactored to discriminated union (2026-04)**

- Replaced the monolithic `KnowledgeUnit` interface in both `backend/src/types/index.ts` and `frontend/src/types/index.ts` with a tagged union of five sub-types, each with a literal `type` discriminant and a narrowed `data` shape:
  - `VocabKnowledgeUnit` — `data: { reading?, definition?, jlptLevel?, wanikaniLevel? }`
  - `KanjiKnowledgeUnit` — `data: { meaning?, jlptLevel?, wanikaniLevel? }`
  - `ConceptKnowledgeUnit` — fully typed `data: { title, overview, mechanics[], examples[] }` (see Concepts section)
  - `GrammarKnowledgeUnit`, `ExampleSentenceKnowledgeUnit` — `data: { [key: string]: any }` (still open)
- Shared fields extracted into `KnowledgeUnitBase` (common to all sub-types, including deprecated user-state fields held in place until the migration is complete).
- All `data` shapes retain `[key: string]: any` so existing unnarrowed access patterns (`ku.data.reading` etc.) continue to compile without changes to call sites.
- `KnowledgeUnitClient` fixed to use a `DistributiveOmit` helper so the discriminated union is preserved through the `Omit<KnowledgeUnit, "createdAt">` operation.
- No runtime changes — Firestore document shapes are unchanged; all backend service construction already used `as unknown as KnowledgeUnit`.
- Switching on `ku.type` now gives correct TypeScript narrowing into the appropriate sub-type.

---

**UI overhaul — profile, avatar, nav restructure (2026-04)**

- Added `frontend/src/components/UserAvatar.tsx` — initials-based avatar circle with deterministic colour derived from email hash.
- Added `frontend/src/components/AvatarMenu.tsx` — avatar button on the far right of the header that opens a dropdown containing Profile & Settings, furigana toggle, Library, Manage, and Sign Out. Manage and Library links removed from the main nav row. The furigana toggle is a pill switch that calls `applyFurigana` + `PATCH /api/users/me/preferences` without closing the menu.
- Added `frontend/src/app/profile/page.tsx` — user profile page showing avatar, email, and a Furigana toggle that persists to the backend.
- Added `frontend/src/lib/furigana.ts` — shared `applyFurigana` / `loadFurigana` utilities (previously duplicated inline in `Header.tsx`).
- `Header.tsx` restructured: furigana toggle removed from header bar (Alt+F shortcut retained, now also PATCHes the backend); Concepts link added between Scenarios and the avatar.
- `UserRoot` gained a top-level `preferences?: { showFurigana?: boolean }` field in both type files. `PATCH /api/users/me/preferences` endpoint added to `UserController` / `UserService`.

**Concepts system (2026-04)**

- New `ConceptKnowledgeUnit` type — fully typed `data` shape replacing the previous `[key: string]: any` open bag:
  - `title`, `overview` (≤ 2 sentences, no English grammar meta-language)
  - `mechanics[]` — intent-driven entries with `goalTitle`, `englishIntent`, `rule`, `simpleExample` (fragment + literal translation + `highlight`), `naturalExample` (full sentence embedding the fragment + `highlight`)
  - `examples[]` — exactly 3 practical sentences with `japanese` (bracket-notation furigana e.g. `彼[かれ]は学生[がくせい]です`), `english`, `targetGrammar` (plain text, no brackets); `reading` field deprecated/optional for backward compat.
  - `highlight` fields use the same verbatim-substring contract as `targetGrammar` and drive bold + dotted-underline rendering in the mechanics cards.
  - `examples` rendered in `concepts/[id]/page.tsx` via `furiganaHighlight` — position-maps plain-text `targetGrammar` into the bracket-notation `japanese` string, then renders each segment through `FuriganaText` with the matched segment wrapped in `<mark>`. Furigana show/hide respects the global `html[data-furigana]` toggle.
- `backend/src/concepts/` module added: `ConceptsService` (generate / findById / findAll), `ConceptsController` (`POST /api/concepts/generate`, `GET /api/concepts`, `GET /api/concepts/:id`), `ConceptsModule` (imports `GeminiModule`).
- `CONCEPTS_COLLECTION = 'concepts'` added to `firebase.module.ts`.
- `GeminiService.generateConcept` added — mirrors `generateLesson` pattern (api-log start/complete, defensive JSON extraction) but uses `this.conceptModelName` sourced from `GEMINI_MODEL` env var, falling back to `this.modelName`. Logs startup line `Using Gemini concept model: …`.
- `frontend/src/app/concepts/[id]/page.tsx` — client component that fetches real concept data from `GET /api/concepts/:id` and renders it with two highlight helpers: `highlightGrammar` (red tint, used in Examples section) and `highlightClause` (bold + dotted underline, used in mechanics Simple/Natural examples).
- `frontend/src/app/admin/concepts/page.tsx` — hidden admin page at `/admin/concepts` for triggering concept generation; accepts Topic and optional Detailed Notes fields that are appended to the prompt as `**Additional notes from the teacher:**`.
- `frontend/src/app/concepts/page.tsx` — empty placeholder page for the Concepts nav link.

---

**Review facets + lesson page overhaul (2026-04-25)**

`generateReviewFacets` (`ReviewsService`) now:
- Pre-fetches existing parent facets before the batch write; standard facet types are skipped if already present (dedup).
- Auto-creates `Kanji-Component-Meaning` + `Kanji-Component-Reading` review facets for each selected kanji component, with per-KU dedup (pre-fetches each kanji's existing facets before creating).
- Tracks `newFacetCount` per kanji; UKU `facet_count` is only incremented for newly created facets.
- Kanji UKU updates run in parallel via `Promise.all` (was sequential `for...await`).
- `batch.commit()` is called _before_ all UKU updates (was after — bug fix).
- Parent UKU `status` is set to `learning` if `count > 0 || kanjiLinked > 0` (was `count > 0` only — bug fix when only kanji components were selected).

`GET /api/reviews/facets?kuId=` — new query param in `ReviewsController`/`ReviewsService` returns all facets for a given KU. Used by the lesson page to determine which facet types already exist.

Lesson page (`/learn/[kuId]`):
- Fetches existing facets and any linked scenarios on load (parallel with lesson fetch).
- Facet checklist conditionally renders: already-configured types shown as disabled checked checkboxes in a subsection; unconfigured types remain selectable. Heading: "Select Additional Items to Review".
- After submit: re-fetches facets and updates UI in-place — no redirect.
- Kanji component status detection: switched from `?status=learning` (broken after `status` moved to UKU) to `?status=user` + client-side filter on `ukuStatus` field.
- Context examples: display "✓ View scenario →" link if a scenario already exists for that sentence (`sourceKuId` lookup), preventing duplicate scenario generation.
- Scenario generation POST includes `sourceKuId: ku.id`.

`GET /api/scenarios?sourceKuId=` — new query param in `ScenariosController`/`ScenariosService`. Returns slim stubs (`id`, `title`, `sourceContextSentence`, `createdAt`) ordered by `createdAt desc`. Requires Firestore composite index on `(userId, sourceKuId, createdAt)` on `scenarios` collection.

Scenario page (`/scenarios/[id]`): shows "← Back to Lesson" breadcrumb when `scenario.sourceKuId` is set.

Library page (`/learn`): Kanji items now show `data.meaning` in the hint column (previously blank).

---

**Grammar Lessons — two-tier Global/User model (2026-04-22)**

- Added `GrammarLesson` (global, context-agnostic) and `UserGrammarLesson` (per-user per-encounter) interfaces to both `backend/src/types/index.ts` and `frontend/src/types/index.ts`. `Lesson` union updated to `VocabLesson | KanjiLesson | GrammarLesson`.
- **Separation of concerns**: The global `GrammarLesson` (stored at `lessons/{kuId}`) holds all teaching content — formation rules, generic examples, JLPT level — and is generated lazily on first learn, then reused for all users. The `UserGrammarLesson` (stored at `users/{uid}/user-grammar-lessons/{kuId}_{sourceType}_{sourceId}`) holds only the user's source context: which scenario or concept introduced the pattern, plus a verbatim `contextExample`. Deterministic doc ID prevents duplicate records per source.
- **`GrammarNote.pattern`**: new optional field (`～をお願いします` style) for extracting a canonical grammar key separate from the full title. Used as the dedup key in `ensureGrammarKU`.
- **`KnowledgeUnitsService.ensureGrammarKU(note)`**: get-or-create helper — finds an existing `GrammarKnowledgeUnit` by `note.pattern ?? note.title`, creates one if not found. Prevents duplicate KUs for the same pattern encountered across different scenarios.
- **`LessonsService` Grammar branch**: `generateLesson` for Grammar type passes the `UserGrammarLesson.contextExample` verbatim to the AI prompt as `examples[0]`, so the familiar sentence anchors the lesson. Stored at `lessons/{kuId}` without a `userId`. `createUserGrammarLesson` and `getUserGrammarLessons` added. `GET /lessons/user-grammar?kuId=` endpoint added.
- **`ScenariosService.advanceState`** (encounter→drill): replaced direct sentence-assembly facet creation with per-grammar-note pipeline — `ensureGrammarKU` → `UserKnowledgeUnitsService.create` → `LessonsService.createUserGrammarLesson`. `LessonsModule` imported by `ScenariosModule`.
- **Learn page Grammar branch**: fetches global lesson + user lessons in parallel. Emits one `sentence-assembly` facet per example, plus `AI-Generated-Question` and `Content-to-Definition`. `Content-to-Definition` tagged with `kuType: 'Grammar'` and `definitions: [lesson.meaning]`.
- **Review page**: `getQuestionType` returns "Grammar Pattern → Meaning" when `data.kuType === 'Grammar'` or no `data.reading` field (legacy facet detection). `getExpectedAnswer` falls back to `facet.data.topic` if `definitions` is empty.
- **`GrammarLessonView.tsx`** (new): renders pattern header, formation block, amber notes callout, examples with source-context banner, and facet selection checkboxes.

---

**`UserConceptsModule` consolidated into `ConceptsModule` (2026-04-22)**

- `UserConceptsService` deleted; its methods (`enroll`, `findAllForUser`, `getFacets`, `createFacets`) merged into `ConceptsService`.
- `UserConceptsController` moved to `backend/src/concepts/user-concepts.controller.ts`; now injects `ConceptsService` directly.
- `ConceptsModule` updated to register both `ConceptsController` and `UserConceptsController`; imports `ReviewsModule`.
- `UserConceptsModule` removed from `AppModule`.
- Eliminates the duplicate `facetsColRef` copy in `UserConceptsService` that was missing the `ADMIN_USER_ID` routing check (partial fix for issue #138 — `StatsService` inline copy remains).

---

**Manage page — Search & Enroll + Import Scenario (2026-04-30)**

- **KU Search endpoint**: `GET /api/knowledge-units/search?q=` — Firestore prefix range query (`.where('content', '>=', q).where('content', '<=', q + '').limit(15)`). Guard on `data.createdAt` before calling `.toDate()` — WaniKani bulk-imported docs have no `createdAt` field.
- **KU create find-or-create**: `KnowledgeUnitsController.create` now calls `findByContent` first; if found, links the user's UKU to the existing global KU and returns `{ id, isNew: false }`. No duplicate global KUs created.
- **Manage page Search & Enroll section** (`frontend/src/app/manage/page.tsx`): debounced (300ms) search input, result list with per-item "Add"/"In queue" state, dedup against enrolled KUs.
- **Import Scenario**: `POST /api/scenarios/import` — `ImportScenarioDto`: `conversationText`, `userRole`, `aiRoles?: string[]` (or legacy `aiRole?: string`), `difficulty?`, `sceneNotes?`. AI preserves Japanese verbatim, maps speaker labels to role names, extracts vocab + grammar. Stored with `sourceType: 'custom'`. New page at `/manage/scenarios`.
- **`buildImportPrompt`** in `backend/src/prompts/scenario.prompts.ts` — instructs AI to preserve Japanese verbatim, map speaker labels to role names, infer setting, return same JSON schema as `buildArchitectPrompt`. Multi-role aware.

**Three-role scenario support (2026-04-30)**

- `Scenario.roles.ai: string | string[]` in both type files — existing single-string docs work without change.
- `ChatMessage.roleName?: string` — set from `speaker` in Gemini's JSON response. Frontend chat bubble shows the actual character name instead of "ai". Falls back to `scenario.roles?.ai` (first element if array) for old messages.
- `buildChatSystemPrompt` accepts `aiRoles: string | string[]`. Tells the AI which characters it plays; for multiple roles adds instruction to respond as ONE character per turn and always set `speaker` to the exact role name.
- `buildImportPrompt` accepts `aiRoles: string[]`. Generates correct `participants` list and `roles.ai` as string (single) or array (multiple) in the output JSON.
- `getInitialChatHistory` — fixed to prefer `scenario.roles` over `determineRoles` fallback; checks first dialogue speaker against all AI roles (array).
- `generateEvaluation` — normalises `roles.ai` to string (`join(', ')`) for the evaluation context passed to Gemini.
- Import form — "Other Role" input is now a dynamic list; "Add another role" link appends a new row; `×` removes. Sends `aiRoles: string[]`.
- Gemini chat response schema already had `speaker: STRING` — now used to populate `ChatMessage.roleName`.

---

**LearningProgressService + lesson page UX overhaul (2026-05-01)**

- **`MASTERED_STAGE = 7`, `SELF_CERTIFIED_STAGE = 6`** added to `backend/src/lib/constants.ts`.
- **`LearningProgressService`** (`backend/src/learning-progress/`) — new `@Global()` service and module registered in `AppModule`. Single owner of `UKU.status`; `recomputeAndCache(uid, kuId)` derives status from facet SRS data and writes to UKU. `ReviewsService` is the only caller — invoked after every facet creation and every SRS update. No other service may write `UKU.status` directly.
- **`ReviewsService.generateReviewFacets`** — now accepts `selfCertifiedFacets: string[]`. Self-certified facets created at stage 6 with `nextReviewAt = now + 730 h` and `selfCertified: true` flag on the Firestore doc. Unchecked facets created at stage 0 as before. Direct `status: 'reviewing'` write removed; replaced with `recomputeAndCache`.
- **`ReviewsService.updateFacetSrs`** — direct `status: 'mastered'` write removed; replaced with `recomputeAndCache`.
- **`POST /api/reviews/generate`** — body now accepts `selfCertifiedFacets?: string[]`.
- **Lesson page UX inverted** (`/learn/[kuId]`): heading changed to "What do you already know?"; all standard facets always enrolled on submit — checked = self-certified (stage 6), unchecked = learn from scratch (stage 0). Kanji component stubs and context-example scenarios remain opt-in. `getAvailableStandardFacetKeys()` helper centralises available-facet computation used by both render and submit. Button: "Enroll in Review Queue".
- **`AI-Generated-Question` display label** renamed to "General usage patterns" on the lesson page, concepts page, and grammar lesson view; "Usage patterns" on the review card header. Firestore `facetType` value `"AI-Generated-Question"` unchanged.

---

- **Firebase Console prerequisites** for project `gen-lang-client-0878434798`:
  1. Authentication → Sign-in method → **Email/Password** enabled.
  2. Authentication → Sign-in method → **Email link (passwordless sign-in)** enabled (sub-toggle under Email/Password).
  3. Authentication → Settings → Authorized domains — ensure `localhost` is listed (removed by default in projects created after 2025-04-28).
  4. **Public-facing name** (controls the app name shown in auth emails): this field only becomes accessible in the Firebase Console once a third-party auth provider (e.g. Google Sign-In) is enabled. Enable Google Sign-In, set the name to `AIGENKI`, then disable Google Sign-In again if passwordless-only is preferred.
