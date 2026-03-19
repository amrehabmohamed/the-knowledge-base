# Personal Knowledge Base

A single-user knowledge management tool inspired by NotebookLM. Upload documents and URLs, query them with Gemini FileSearch, and get cited answers.

## Tech Stack

- **Frontend**: React + Vite + TypeScript, shadcn/ui + prompt-kit + Tailwind CSS
- **Fonts**: Outfit (headings, `font-heading`), Urbanist (body, `font-body`)
- **Auth**: Firebase Auth (email/password)
- **Database**: Cloud Firestore
- **Storage**: Cloud Storage
- **Backend**: Cloud Functions (Node.js, TypeScript) in `functions/`
- **RAG**: Gemini FileSearch Store API (single store, `uploadToFileSearchStore` with customMetadata)
- **URL Extraction**: Jina Reader API
- **Hosting**: Netlify

## Project Structure

- `src/` — React frontend
  - `src/features/` — Feature modules (auth, notebooks, sources, chat, settings)
  - `src/components/ui/` — shadcn/ui + prompt-kit components
  - `src/lib/firebase.ts` — Firebase SDK initialization
  - `src/lib/utils.ts` — shadcn utility (cn function)
  - `src/lib/firestore.ts` — Typed Firestore collection/document helpers
  - `src/lib/formatters.ts` — Date, file size, text truncation formatters
  - `src/lib/api.ts` — Cloud Functions callable helper
  - `src/lib/streaming.ts` — SSE streaming client for chat endpoint
  - `src/types/` — Shared TypeScript interfaces (Notebook, Source, Session, Message)
  - `src/config/constants.ts` — File types, size limits, status config, Gemini models, function URLs
- `functions/src/` — Cloud Functions backend
  - `functions/src/services/` — API wrappers (Gemini, Jina, Storage)
  - `functions/src/middleware/` — Auth token validation
  - `functions/src/config.ts` — Environment variable access
  - `functions/src/types/` — Backend type definitions
- `firestore.rules` — Firestore security rules
- `storage.rules` — Cloud Storage security rules

## Key Commands

```bash
npm run dev          # Start Vite dev server (port 5173)
npm run build        # Build for production
cd functions && npm run build  # Build Cloud Functions
firebase deploy --only functions  # Deploy functions
firebase deploy --only firestore:rules  # Deploy Firestore rules
firebase deploy --only storage  # Deploy storage rules
firebase deploy --only firestore:rules,firestore:indexes  # Deploy rules + indexes together
```

## Environment

- Firebase project: `the-knowledge-base-82d72`
- Config in `.env` (gitignored), template in `.env.example`
- Frontend vars use `VITE_` prefix
- Function secrets in `functions/.env` (gitignored), accessed via `process.env`
- `functions.config()` is deprecated — do NOT use it

## Conventions

- TypeScript strict mode
- Functional React components with hooks
- Feature-based folder structure
- shadcn/ui for all base components
- prompt-kit for chat UI components
- `@/` path alias maps to `src/` (configured in tsconfig)
- shadcn components use base-ui primitives (not radix) — Dialog uses `@base-ui/react/dialog`
- Firestore `list` queries: avoid `resource.data` checks in security rules for collection queries
- Firestore composite indexes: define in `firestore.indexes.json`, single-field indexes are auto-created
- Cloud Functions use v2 API (`firebase-functions/https`, `firebase-functions/firestore`)
- Gemini SDK: use `@google/genai` (not `@google/generative-ai` which lacks Files API)
- Upload pipeline: frontend uploads to Cloud Storage → Firestore trigger → `uploadToFileSearchStore` (single-step store upload with metadata)
- Chat streaming: SSE via Cloud Functions v2 `onRequest` (not `onCall` — it doesn't support streaming)
- Gemini FileSearch `metadataFilter` is broken at API level (silently returns no results) — metadata stored for future use but filtering not enabled
- Gemini model IDs: use preview/stable strings (e.g. `gemini-3-flash-preview`, `gemini-2.5-flash`) — check for deprecations
- Source tags: stored as `customMetadata` on Gemini store documents alongside `notebookId`

## Build Status

- **Phase 0**: Complete (scaffold)
- **Phase 1A**: Complete (auth, notebooks, file upload, source status, security rules)
- **Phase 1B**: Complete (URL ingestion, chat with streaming/citations, model selection, session reset, upload dialog with tags)
- **Phase 1C**: Not started (summarization, archive, system status/warm-up, deployment)

## Full Requirements

See `KB-MVP-PRD.md` for complete PRD.
