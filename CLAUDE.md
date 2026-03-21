# Personal Knowledge Base

A single-user knowledge management tool inspired by NotebookLM. Upload documents and URLs, query them with Gemini FileSearch, and get cited answers.

## Tech Stack

- **Frontend**: React + Vite + TypeScript, shadcn/ui + prompt-kit + Tailwind CSS
- **Fonts**: Outfit (headings, `font-heading`), Urbanist (body, `font-body`)
- **Auth**: Firebase Auth (email/password, signup disabled on frontend)
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
  - `src/lib/utils.ts` — shadcn utility (cn function) + RTL text detection (`getTextDir`)
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
- `functions/src/telegram/` — Telegram bot integration
  - `webhook.ts` — Main onRequest handler with webhook secret validation
  - `commands.ts` — Command handlers (/start, /notebooks, /switch, /model, /status, /reset, /help, /unlink) + web tool commands in /help
  - `chat.ts` — Chat message handler with session lifecycle (24h expiry) + slash command parsing (/web, /maps, /url)
  - `telegramClient.ts` — Telegram Bot API wrapper (sendMessage, markdownToTelegramHtml)
  - `rateLimiter.ts` — In-memory sliding window rate limiter (5/min per user, 30/min global)
  - `types.ts` — Telegram-specific type definitions
- `prompt-templates/` — Reusable system prompt templates (future feature)
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
- Netlify env vars: `VITE_` vars must be set in Netlify dashboard (Project configuration → Environment variables) for production builds
- Telegram bot secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`) in `functions/.env` only (not needed on Netlify)

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
- Gemini FileSearch `metadataFilter` is active — uses AIP-160 filter syntax (`notebook_id = "<id>"`) for notebook-level data isolation
- CRITICAL: Gemini metadataFilter does NOT support camelCase keys (silently returns no results) — always use snake_case for custom metadata keys
- Source tags from users should also use snake_case keys to be filterable
- Gemini model IDs: use preview/stable strings (e.g. `gemini-3-flash-preview`, `gemini-2.5-flash`) — check for deprecations
- Source tags: stored as `customMetadata` on Gemini store documents alongside `notebookId`
- RTL support: `getTextDir()` in `src/lib/utils.ts` auto-detects Arabic/Hebrew text and sets `dir="rtl"` on message content
- Chat layout: user messages are right-aligned dark bubbles, AI messages are left-aligned with bot icon — conversational style
- Per-notebook system prompt: stored as `systemPrompt` field on notebook doc, appended to default system prompt server-side
- Token counting: server-side via Gemini `usageMetadata.totalTokenCount`, stored on session via Firestore `increment()`
- Summarization: triggers at 500K tokens, uses `gemini-2.5-flash`, 60s cooldown on failure
- Channel-aware prompts: `CHANNEL_PROMPT_OVERRIDES` in config.ts appends channel-specific instructions (e.g. no citations for Telegram)
- Telegram bot: uses raw `fetch` calls to Telegram Bot API (no npm package), webhook via Cloud Functions v2 `onRequest`
- Telegram auth: email OTP linking via Firebase Trigger Email extension + Gmail SMTP, stored in `telegramLinks` collection
- Telegram formatting: Gemini Markdown → HTML conversion (`markdownToTelegramHtml`) with `"HTML"` parse mode
- Telegram sessions: 24h auto-expiry, in-memory `chatStates` Map (rehydrated on cold start from Firestore)
- Cloud Functions v2 requires `allUsers` invoker policy for public webhooks: `gcloud functions add-invoker-policy-binding <name> --member=allUsers`
- Gemini built-in tools (FileSearch, googleSearch, urlContext, googleMaps) CANNOT be combined in the same request — use one at a time
- Web tools via slash commands: `/web` (Google Search), `/maps` (Google Maps), `/url` (URL Context) — parsed in frontend (`useChat.ts`) and Telegram (`chat.ts`), sent as `toolOverride` param to backend
- Default tool is always FileSearch (uploaded sources); slash commands override to a specific web tool for that message only
- Per-notebook tool toggles stored as `tools` field on notebook doc (e.g. `{ googleSearch: true }`) — controls which tools are available but slash commands are the actual trigger
- Frontend slash command menu: typing `/` in chat input shows a popup menu (ChatInput.tsx) with keyboard navigation

## Build Status

- **Phase 0**: Complete (scaffold)
- **Phase 1A**: Complete (auth, notebooks, file upload, source status, security rules)
- **Phase 1B**: Complete (URL ingestion, chat with streaming/citations, model selection, session reset, upload dialog with tags)
- **Phase 1C**: Complete (summarization, archive, system status/warm-up, per-notebook system prompt, token counting, RTL support, chat layout redesign, Netlify deployment)
- **Phase 2**: Complete (Telegram bot — email OTP linking, notebook/model selection, session management, rate limiting, channel-aware prompts, location support, HTML formatting)
- **Phase 3**: Complete (Web tools — Google Search, Google Maps, URL Context via slash commands /web /maps /url, per-notebook tool settings, slash command menu in web UI)

## Full Requirements

See `KB-MVP-PRD.md` for complete PRD.
