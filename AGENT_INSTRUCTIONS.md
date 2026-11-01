# Agent Instructions & Project Guidelines

> **Notice to AI Agents**: `ARCHITECTURE.md` and `DOMAIN_MODEL.md` are the definitive sources of truth regarding the architecture and domain model of AISRS-Japanese. AISRS-Japanese is sometimes referred to as AIGENKI.

## Core Directives
1. **Be Objective & Critical**: Do not act as a sycophant. Question impractical ideas and offer constructive criticism.
2. **Prioritize Code & Action**: Provide complete, production-ready code. Default to concrete steps.
3. **Respect the Architecture**: Use Next.js 15+ (App Router), NestJS (Backend), React 19, TypeScript, Tailwind v4, and Firestore. 
   - Never query Firestore from the frontend. The backend handles all database and Gemini API logic.

## Codebase Management
- **Tool Versions**: Always assume and use LTS (Long-Term Support) versions of Node.js and other core dependencies.
- **Package Management**: Use `yarn` exclusively (`yarn add`, `yarn remove`). NEVER run `npm install`.
- **Git Flow**: **NEVER push directly to the `main` branch.** Always create a new branch for every feature or fix (e.g., `feat/my-feature`, `fix/my-bug`) and use Pull Requests.
- **Commits**: Format commits to reference issue numbers (e.g., `feat: update prompt logic, fixes #12`).
- **GitHub identity**: All AI-agent GitHub activity (issues, PR/issue comments, commits, pushes) MUST be attributed to the `claude-reviewer-aigenki` GitHub App bot, never the human user's own account. Mint a short-lived installation token with `node scripts/github-app-token.js` (config in `scripts/.env.github-app`, gitignored) and use it via `GH_TOKEN=$(node scripts/github-app-token.js) gh <command>`, or as the password in an `https://x-access-token:<token>@github.com/...` remote URL for `git push`. Never use the ambient `gh auth login` session for agent-initiated GitHub actions.
- **Editing Tool**: Always use standard code block edits with atomic, idempotent approaches. Avoid massive raw rewrites where localized modifications are sufficient.

## Development "Gotchas"
- **Dates & Firestore**: A historically painful bug in this project involves date parsing. **All dates (`nextReviewAt`, `createdAt`, etc.) MUST be saved as Firebase `Timestamp` objects or native `Date` (which NestJS/Firebase admin serialize) on the backend**. Never save date fields as ISO Strings, as this breaks `where('nextReviewAt', '<=')` range queries.
- **Firebase Admin SDK Rules**: Do not use `firebase-admin` on Next.js server/API routes. While these routes are mostly deprecated, note that `FieldValue` and `FieldPath` imports cause immediate serverless edge crashes in Next.js. The current architecture strictly relegates these to the NestJS `/backend`.
- **Gemini API Prompting**: The current version used by the app is `gemini-3.8-flash` (update the docs if this changes). In this project, comprehensive single `userMessage` instructions (with temperature ~0.4) combined with explicit schema instructions typically yield more reliable JSON returns than splitting instructions between `systemInstruction` and the `responseSchema` param.

## Frontend UI Rules
- When synchronizing states across distinct frontend components (like the navigation header counts vs list elements), dispatch a localized window event (e.g., `window.dispatchEvent(new CustomEvent('refreshStats'))`). Do not overly rely on complex global state managers simply for localized counter refresh.

## Project Run State
- Ensure the backend (`yarn start:dev` on port 3500) and frontend (`yarn dev` on port 3000) are running simultaneously when verifying tasks.

## Project maintenance

- Once you've completed a task, update the `ARCHITECTURE.md` and `AGENT_INSTRUCTIONS.md` files to reflect the changes you've made. In Architecture.md, update the "Migration History" section to include the changes you've made.