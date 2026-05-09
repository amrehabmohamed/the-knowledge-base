# Personal Knowledge Base

A single-user knowledge management tool inspired by NotebookLM. Upload documents and URLs, query them with Gemini FileSearch, and get cited answers.

## ⚠️ Current Working State (read this first)

- **Active branch**: `feat/multi-tool-orchestrator` (cut from `main`). Do NOT push to `main` or deploy to prod from this branch without explicit user approval.
- **Active environment**: `staging` (Firebase project `the-knowledge-base-staging`). All deploys/tests during this work go there. Production (`the-knowledge-base-82d72`) is untouched and still runs the legacy single-tool code from `main`.
- **What's in flight**: Phase 5 multi-tool orchestrator (FileSearch + 3 sub-agents + Jina prefetch + tool-call UI cards). See the Phase 5 entry in Build Status below.
- **How to deploy to staging**: `firebase deploy --only functions --project staging` (or `npm run deploy:staging`). Frontend dev mode: `npm run dev:staging`.
- **How to deploy to prod**: `firebase deploy --only functions --project prod` — but only AFTER the branch is reviewed, smoke-tested on staging, and the user has explicitly approved a merge to `main`.
- **Feature flag**: `MULTI_TOOL_ENABLED=true` is set in `functions/.env.the-knowledge-base-staging` only. Prod stays `false` (legacy single-tool path) until verified.

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

- Firebase projects (aliases in `.firebaserc`):
  - `prod` (default): `the-knowledge-base-82d72` — main user-facing project
  - `staging`: `the-knowledge-base-staging` — for testing the multi-tool orchestrator and other risky changes before merging to `main`
- Staging Storage bucket is `kb-staging-files` (custom name; the default `*.firebasestorage.app` and `*.appspot.com` were domain-locked). Mapped via `firebase target:apply storage staging kb-staging-files`. Frontend reads `VITE_FIREBASE_STORAGE_BUCKET` so this is transparent.
- Staging FileSearch store: `fileSearchStores/kbstaging-v5jcj3myvved` (separate from prod store). Created via the Gemini API.
- Staging reuses the prod Gemini API key + Jina API key (single-user app, low volume). Telegram is NOT deployed in staging.
- `MULTI_TOOL_ENABLED=true` is set ONLY in `functions/.env.the-knowledge-base-staging` — prod stays on legacy single-tool path until verified.
- Frontend env files: `.env` (prod), `.env.staging` (staging) — Vite picks via `--mode`. Run `npm run dev:staging` or `npm run build:staging` to target staging.
- Functions env: `.env` (prod), `.env.the-knowledge-base-staging` (auto-loaded by Firebase CLI when deploying to that project). Do NOT use deprecated `functions.config()`.
- Deploy commands: `firebase deploy --only functions --project staging` (or `npm run deploy:staging`). For prod use `--project prod` explicitly.
- Frontend vars use `VITE_` prefix. Netlify env vars (Project config → Environment variables) are needed for prod hosting builds only.
- Branch convention: risky/exploratory work (e.g. `feat/multi-tool-orchestrator`) lives on a feature branch, deploys to `staging` first, only merges to `main` after verification.

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
- Gemini built-in tools (FileSearch, googleSearch, urlContext, googleMaps) CANNOT be combined directly in the same request — official FileSearch docs explicitly forbid it. Multi-tool support is achieved via the orchestrator (`functions/src/services/orchestrator.ts`): parent Gemini 3 model runs FileSearch + custom function declarations (`web_search`, `maps_search`, `url_fetch`) with `includeServerSideToolInvocations: true`. Each function maps to a single-purpose sub-agent in `functions/src/services/subagents/` that runs ONE built-in tool on `gemini-3.1-flash-lite`. Lightweight QC validates each sub-agent result before it's exposed to the parent (soft mode: accepts non-empty summary even without grounding citations). Gated by `MULTI_TOOL_ENABLED` env flag; falls back to legacy single-tool path on Gemini 2.5 or when a slash command is used
- Streaming part-merge for Gemini 3 thinking models (`functions/src/services/orchestrator.ts`): parts from each chunk are pushed in order, and any signature-only part (no data field) is folded into the most recent data-bearing part. This preserves `thoughtSignature` while keeping mutually-exclusive `oneof` data fields (text/functionCall/toolCall/toolResponse) on separate parts — the API rejects parts with multiple data fields set
- URL prefetch via Jina Reader (`functions/src/services/urlPrefetch.ts`): when the user pastes URLs in their chat message, the orchestrator AND the legacy path call Jina to extract clean markdown (capped: 3 URLs/turn, 8000 chars each) and inject the content into the user message before sending to Gemini. Failures are logged and skipped — `url_fetch` sub-agent is still available as a fallback. Independent of `MULTI_TOOL_ENABLED` so prod gets URL prefetch too once merged
- Tool call surfacing in the UI (`src/features/chat/components/ToolCallCard.tsx`): backend emits a new `tool_call` SSE event (`{id, name, args, status: running|done|error, output?, citations?, error?, durationMs?}`) for each Jina prefetch and each sub-agent dispatch. Frontend collects them into `streamingToolCalls` (in `useChat.ts`) and renders inline pills above the assistant message — click to expand the raw tool output. Persisted on the assistant message doc as `toolCalls?: ToolCall[]` so they survive reload. Tool-call events flow through `streaming.ts` via a new `onToolCall` callback. Server-side `toolCall`/`toolResponse` parts (Gemini's native FileSearch invocation) are NOT surfaced as cards in v1 — citations on the message already indicate FileSearch was used
- Soft QC mode (`functions/src/services/subagents/qc.ts`): sub-agent results are accepted as long as `summary.trim()` is non-empty. Zero-grounding-citation results are logged (`[QC <name>] soft-pass`) and passed through, not rejected. Tighten later if hallucinations become a problem
- Markdown link styling (`src/components/ui/markdown.tsx`): `<a>` tags rendered by ReactMarkdown use the standard blue underline (`text-blue-600 underline`), open in new tab with `noopener noreferrer`, and `break-all` so long URLs wrap inside the chat bubble
- Web tools via slash commands: `/web` (Google Search), `/maps` (Google Maps), `/url` (URL Context) — parsed in frontend (`useChat.ts`) and Telegram (`chat.ts`), sent as `toolOverride` param to backend
- Default tool is always FileSearch (uploaded sources); slash commands override to a specific web tool for that message only
- Per-notebook tool toggles stored as `tools` field on notebook doc (e.g. `{ googleSearch: true }`) — controls which tools are available but slash commands are the actual trigger
- Frontend slash command menu: typing `/` in chat input shows a popup menu (ChatInput.tsx) with keyboard navigation
- Multimodal chat: users can attach images, audio, and PDFs in chat messages (web + Telegram)
- Chat attachments stored in Cloud Storage at `users/{uid}/chat-attachments/{notebookId}/{sessionId}/`
- Attachment metadata stored on message doc as `attachments?: Attachment[]` (type, mimeType, fileName, sizeBytes, storageRef, downloadUrl)
- Gemini multimodal: attachments sent as `inlineData` parts alongside text in the user message; history remains text-only
- Chat function memory bumped to 512MiB to handle file download + base64 encoding
- Telegram media: photos, voice messages, audio files, and PDF documents → downloaded via Bot API → uploaded to Cloud Storage → passed to Gemini
- Max chat attachment size: 10MB per file, max 5 attachments per message

## Build Status

- **Phase 0**: Complete (scaffold)
- **Phase 1A**: Complete (auth, notebooks, file upload, source status, security rules)
- **Phase 1B**: Complete (URL ingestion, chat with streaming/citations, model selection, session reset, upload dialog with tags)
- **Phase 1C**: Complete (summarization, archive, system status/warm-up, per-notebook system prompt, token counting, RTL support, chat layout redesign, Netlify deployment)
- **Phase 2**: Complete (Telegram bot — email OTP linking, notebook/model selection, session management, rate limiting, channel-aware prompts, location support, HTML formatting)
- **Phase 3**: Complete (Web tools — Google Search, Google Maps, URL Context via slash commands /web /maps /url, per-notebook tool settings, slash command menu in web UI)
- **Phase 4**: Complete (Multimodal chat — image/audio/PDF attachments in web and Telegram, Gemini native vision/audio understanding)
- **Phase 5** (in-progress on `feat/multi-tool-orchestrator`, deployed to staging only): Multi-tool orchestrator. Parent Gemini 3 model coordinates FileSearch + 3 single-purpose sub-agents (`web_search`, `maps_search`, `url_fetch`) running on `gemini-3.1-flash-lite` via custom function declarations + `includeServerSideToolInvocations: true`. Lightweight QC, Jina URL prefetch as a pre-step, tool-call cards in the UI, blue-link styling. Gated by `MULTI_TOOL_ENABLED` env flag (`true` on staging, off on prod). Falls back to legacy single-tool path on Gemini 2.5 or when a slash command is used. Not yet merged to `main`/prod

## Full Requirements

See `KB-MVP-PRD.md` for complete PRD.
