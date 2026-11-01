# AIGENKI-Japanese

AIGENKI-Japanese is a bilingual, AI-enhanced Genki Like learning system for Japanese language learning. The current version of the app uses Google Gemini 3.0 Flash Preview to generate custom lessons and context for vocabulary and kanji, dynamically creating review facets based on user selections.

The application leverages a split architecture:
- **Frontend**: Next.js 15 (App Router), React 19, Tailwind CSS v4.
- **Backend**: NestJS REST API, managing scheduling and LLM generation.
- **Database**: Firestore.

## Core Documentation

If you are a contributor or an AI agent working on this project, please consult the core documentation files before proceeding:

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture, tech stack, and responsibilities.
- [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) - Definitions of Knowledge Units (KU), Review Facets, Scenarios, etc.
- [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md) - Important rules and guidelines for AI coding assistants.

## Getting Started

You'll need to supply your own Gemini API key (as `GEMINI_API_KEY`) and store it in an `.env` or `.env.local` file in the backend directory. The app currently requires `gemini-3.8-flash` for reliable lesson generation. (If the model is upgraded, be sure to update this documentation).

**Prerequisites:**
- Node.js (LTS version)
- Yarn (use `yarn` exclusively, do not use `npm`)
- Firebase CLI (optional, if using the Firestore emulator for testing)

**1. Start the Database Emulator (Optional for testing):**
```bash
firebase emulators:start
```

**2. Start the Backend:**
Open a new terminal and run:
```bash
cd backend
yarn install
yarn start:dev
```

**3. Start the Frontend:**
Open another terminal and run:
```bash
cd frontend
yarn install
yarn dev
```

The frontend will be available at [http://localhost:3000](http://localhost:3000) and the backend API at `http://localhost:3500`.
