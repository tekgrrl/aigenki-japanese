# AGENTS.md

Last reviewed: 2026-05-23

This file gives AI coding agents the context they need to work effectively in this repository. Read it before making changes.

## What this project is

AISRS-Japanese is a bilingual Language Learning app utilizing AI (Google Gemini) to generate comprehensive lessons of Japanese language Vocab, Grammar and Concepts tailored to the user's progress. Progress is tracked via review process that leverages a spaced repetition system, and through a scenarios process which evaluates the user's progress through conversational roleplay scenarios. The app is designed to be multi-tenant but is more of a learning tool for the developer. 

## Tech stack

- **Language(s):** TypeScript 5.x
- **Framework(s):** Next.js 15 App Router, NestJS 11
- **Runtime:** Node 22
- **Database:** Firebase Firestore (Cloud Hosted)
- **Key libraries:** Google GenAI, Firebase Admin
- **Hosting/deploy:** Local

## Repository layout

The application is built on a split architectural model:
- **Frontend** (`/frontend` folder): A Next.js 15 app router application providing the UI.  
  - **/frontend/src/app/**: The root pages directory for Next.js App Router.
  - **/frontend/src/components/**: Reusable React components.
  - **/frontend/src/store/**: Global state management (if applicable).
  - **/frontend/src/styles/**: Global styles and theme.
  - **/frontend/src/lib/**: Utility functions for the application.
  - **/frontend/src/api/**: API client code for interacting with the backend.
  - **/frontend/src/types/**: Type definitions for the application.
  - **/frontend/public/**: Static assets.
- **Backend** (`/backend` folder): A NestJS REST API server handling all business logic, DB interactions, and third-party API calls.
  - **/backend/scripts/**: Utility scripts for database management, content seeding, and other administrative tasks.
  - **/backend/src/**: The core backend service layer. All business logic and data access logic lives here.
  - **/backend/src/types/**: Type definitions for the application.
  - **/backend/src/config/**: Configuration management for the application.
  - **/backend/src/lib/**: Utility functions for the application.

## How to run, build, test

```bash
`yarn install` in `/backend` and `/frontend`

# Dev server
Frontend: Runs on `http://localhost:3000` (`yarn dev` inside `/frontend`)
Backend: Runs on `http://localhost:3500` (`yarn start:dev` inside `/backend`)

```

**Before committing:** No unit tests currently just make sure that the TypeScript compiler  runs cleanly, the build still works and the app starts up correctly.

## Conventions

### Code style
- No Rules. 

### State management / data flow
- Next.js App Router provides Server Components, Client Components, and Server Actions, otherwise it's a traditional SaaS model. The frontend is only allowed to access the DB via the backend API. This is a hard rule that must be followed. NEVER attempt to access the DB directly from the frontend. 


### Error handling
- During development it's more important to surface runtime errors via the backend and frontend consoles then expose them to the user. Gemini errors are captured by the Apps' extensive Gemini API logging. All calls to Gemini must be logged as per existing endpoints on the Gemini backend module. 

### Testing
- Hand testing only. Production data is test data. The aim should be that Global data (data at the top level of firestore collections i.e.KU collections) in Firestore is immutable and should never be changed except via the admin dashboard. User data is mutable and can be changed via the app.

## Patterns to follow

- **Dates & Firestore**: A historically painful bug in this project involves date parsing. **All dates (`nextReviewAt`, `createdAt`, etc.) MUST be saved as Firebase `Timestamp` objects or native `Date` (which NestJS/Firebase admin serialize) on the backend**. Never save date fields as ISO Strings, as this breaks `where('nextReviewAt', '<=')` range queries.
- **Firebase Admin SDK Rules**: Do not use `firebase-admin` on Next.js server/API routes. While these routes are mostly deprecated, note that `FieldValue` and `FieldPath` imports cause immediate serverless edge crashes in Next.js. The current architecture strictly relegates these to the NestJS `/backend`.
- **Gemini API Prompting**: The current version used by the app is `gemini-3.8-flash` (update the docs if this changes). In this project, comprehensive single `userMessage` instructions (with temperature ~0.4) combined with explicit schema instructions typically yield more reliable JSON returns than splitting instructions between `systemInstruction` and the `responseSchema` param.

## Dependencies

- See @frontend/package.json and @backend/package.json

## Data model (high level)

See @backend/src/types/index.ts for the data model.

## Environment & secrets

- Secrets in `.env` (gitignored)
- **Never commit:** [.env, credential files, etc.]

## Project Workflow & Best Practices
- **Tool Versions**: Always assume and use LTS (Long-Term Support) versions of Node.js and other core dependencies.
- **Package Management**: Use `yarn` exclusively (`yarn add`, `yarn remove`). NEVER run `npm install`.
- **Git Flow**: **NEVER push directly to the `main` branch.** Always create a new branch for every feature or fix (e.g., `feat/my-feature`, `fix/my-bug`) and use Pull Requests.
- **Commits**: Format commits to reference issue numbers (e.g., `feat: update prompt logic, fixes #12`).
- **GitHub identity**: All AI-agent GitHub activity (issues, PR/issue comments, commits, pushes) MUST be attributed to the `claude-reviewer-aigenki` GitHub App bot, never the human user's own account. Mint a short-lived installation token with `node scripts/github-app-token.js` (reads config from `scripts/.env.github-app`, gitignored — do not commit it or the app's private key) and use it via `GH_TOKEN=$(node scripts/github-app-token.js) gh <command>` for `gh` CLI actions, or as the password in an `https://x-access-token:<token>@github.com/...` remote URL for `git push`. Never fall back to the ambient `gh auth login` session for agent-initiated GitHub actions.
- **Editing Tool**: Always use standard code block edits with atomic, idempotent approaches. Avoid massive raw rewrites where localized modifications are sufficient.


## Out of scope

See @ARCHITECTURE.md, @CONTENT-QUALITY-GUIDE.md, @DOMAIN-MODEL.md, @DATA-MODEL.md

## When in doubt

- Match the style of the nearest existing code that does something similar.
- Prefer small, focused changes. Don't refactor adjacent code unless asked.
- If a change touches more than [10] files or introduces a new dependency, surface that before doing it.
- Ask if the spec is ambiguous, unless explicitly told to proceed without asking.