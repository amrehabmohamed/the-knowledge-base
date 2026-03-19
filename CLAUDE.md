# Personal Knowledge Base

A single-user knowledge management tool inspired by NotebookLM. Upload documents and URLs, query them with Gemini FileSearch, and get cited answers.

## Tech Stack

- **Frontend**: React + Vite + TypeScript, shadcn/ui + prompt-kit + Tailwind CSS
- **Fonts**: Outfit (headings, `font-heading`), Urbanist (body, `font-body`)
- **Auth**: Firebase Auth (email/password)
- **Database**: Cloud Firestore
- **Storage**: Cloud Storage
- **Backend**: Cloud Functions (Node.js, TypeScript) in `functions/`
- **RAG**: Gemini FileSearch API (single store, notebook isolation via metadata)
- **URL Extraction**: Jina Reader API
- **Hosting**: Netlify

## Project Structure

- `src/` — React frontend
  - `src/features/` — Feature modules (auth, notebooks, sources, chat, settings)
  - `src/components/ui/` — shadcn/ui + prompt-kit components
  - `src/lib/firebase.ts` — Firebase SDK initialization
  - `src/lib/utils.ts` — shadcn utility (cn function)
- `functions/src/` — Cloud Functions backend
  - `functions/src/services/` — API wrappers (Gemini, Jina, Storage)
  - `functions/src/middleware/` — Auth token validation
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
```

## Environment

- Firebase project: `the-knowledge-base-82d72`
- Config in `.env` (gitignored), template in `.env.example`
- Frontend vars use `VITE_` prefix
- Function secrets set via Firebase environment config

## Conventions

- TypeScript strict mode
- Functional React components with hooks
- Feature-based folder structure
- shadcn/ui for all base components
- prompt-kit for chat UI components

## Full Requirements

See `KB-MVP-PRD.md` for complete PRD.
