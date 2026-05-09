# Personal Knowledge Base

A single-user knowledge management tool inspired by NotebookLM. Upload documents and URLs, query them with Gemini FileSearch, and get cited answers.

## ⚠️ Current Working State (read this first)

- **Active branch**: `feature/tech-trax-crm-connector` (cut from `main`, no upstream yet). Building the **TechTrax CRM connector** as the second provider on the framework. `main` has Phase 5 + Phase 6 merged (orchestrator + Google Calendar) at `edf040d`.
- **Active environment**: **local Firebase emulator** (`firebase emulators:start --only functions,firestore,auth`) — port 5002 for functions, 4000 for the UI, project alias `demo-kb-local`. Staging (`the-knowledge-base-staging`) still runs the merged Phase 5+6 code from before this branch. Production untouched.
- **What's in flight**: TechTrax CRM connector with 7 tools (`crm_list_stages`, `crm_list_leads`, `crm_get_lead`, `crm_create_lead`, `crm_update_lead`, `crm_transition_stage`, `crm_assign_lead`). Plus framework-level enhancements that benefit *every* connector: natural-language date parsing, server-side phone normalization, optimistic-lock race fix, post-refresh card state recovery. See "Phase 7" entry under Build Status.
- **How to start a fresh session continuing this work**:
  1. `cd /Users/Amr/Downloads/apps/the-knowledge-base && git checkout feature/tech-trax-crm-connector`.
  2. `cd functions && npm install && npm run build` (chrono-node, libphonenumber-js, googleapis, etc. all already in package.json).
  3. Start TechTrax backend locally (their repo) so the CRM API responds at whatever URL the connector is configured to call (set via the Tech Trax connect callable; stored encrypted per-user).
  4. `firebase emulators:start --only functions,firestore,auth` from the project root. Watch its stdout for `[CONFIRM]`, `[CONNECTOR]`, `[tech_trax_crm.*]` log lines.
  5. `npm run dev:staging` for the frontend (port 5173). The frontend points at the *local emulator* via the standard Firebase emulator wiring — verify `src/lib/firebase.ts` has `connectFunctionsEmulator` / `connectFirestoreEmulator` / `connectAuthEmulator` wired when running locally.
  6. Login as `admin@test.local` / `Admin@123` (created in the auth emulator; password set via Admin SDK earlier — see memory entry).
  7. Submit chat prompts to exercise the CRM. The agent will route to `crm_*` tools.
- **How to deploy to staging or prod**: don't from this branch. When TechTrax is verified, merge into `main` and deploy via `firebase deploy --only functions --project staging` first, then prod after env vars are set on the prod GCP project.
- **Feature flags (4 layers — Phase 7 added one)**:
  1. `MULTI_TOOL_ENABLED` (functions env) — gates the orchestrator path. `true` on staging, `false` on prod.
  2. `CONNECTORS_ENABLED` (functions env) — gates `bootConnectors()` and per-user connector tool merging. `true` on staging, `false` on prod. **Must remain `false` wherever any provider's required env vars (`GOOGLE_OAUTH_*`, `TECH_TRAX_*` if any) are unset.**
  3. `VITE_CONNECTORS_ENABLED` (frontend env, build-time) — gates `/settings/connectors` route and Connectors nav button. `true` on staging, `false` on prod.
  4. **TechTrax credentials are per-user, captured by the `connectTechTraxCrm` callable**, not a global env var. Stored at `users/{uid}/connectors/tech_trax_crm/_secrets` (encrypted via Cloud KMS envelope, same shape as Google's refresh token).

## Resuming work in a new session — quick orientation

If you're a fresh Claude session reading this, here's what you need to know to continue without breaking anything:

### Where we are right now
- Branch `feature/tech-trax-crm-connector`, **uncommitted**. The current diff = full TechTrax CRM connector + Phase 7 framework enhancements. Run `git status` and `git diff main..HEAD -- ':(exclude)package-lock.json'` to see the full picture.
- `main` has Phase 5 + 6 merged at `edf040d`. **Don't push this branch to main yet** — TechTrax connector hasn't been verified end-to-end through every flow.
- Local Firebase emulator is the test environment. Staging Calendar still works (deployed) but TechTrax CRM is local-only until merged.

### Files to skim first
- `functions/src/services/connectors/types.ts` — the `ConnectorProvider`, `ConnectorTool`, `ConnectorContext` shape. Every provider plugs in here.
- `functions/src/services/connectors/registry.ts` — the singleton registry + `dispatch()` (read vs write vs scope_required vs validation_pending vs awaiting_approval result kinds).
- `functions/src/services/connectors/google_calendar/index.ts` — the reference provider.
- `functions/src/services/connectors/tech_trax_crm/{index,handlers,validator,schemaCache,client,phone,connectCallable,credentialsForm}.ts` — current TechTrax work.
- `functions/src/services/connectors/dateTime.ts` — natural-language date parsing helper.
- `functions/src/index.ts` — Cloud Functions exports (`chat`, `connectorOAuth*`, `getConnectorStatus`, `disconnectConnector`, `confirmPendingAction`, `cancelPendingAction`, `getPendingActionStatus`, `connectTechTraxCrm`, `techTraxCredentialsForm`).
- `src/lib/connectorActionStore.ts` — module-level runtime state for HITL cards.
- `src/features/chat/components/ActionApprovalCard.tsx` — the HITL approval UI.

### Patterns to follow when adding new tools / connectors
- **Never emit `undefined`** in objects you persist to Firestore. Build incrementally (`if (raw.x) obj.x = raw.x`).
- **Stripping `undefined`** with `Object.entries` recursion is the wrong default — it clobbers `Timestamp` and other class instances (`constructor !== Object`). The helpers in `audit.ts` / `pendingActions.ts` already special-case this; if you write your own, use the same constructor check.
- **Idempotency on writes** — derive a deterministic key from `{uid, sessionId, tool, canonical(args)}` and pass it to the upstream API (Calendar accepts `id`; Tech Trax accepts `Idempotency-Key`).
- **Read-before-write** — for update / delete / RSVP / transition, always GET first to validate existence and (for Tech Trax) capture a fresh `Last-Modified` lock token.
- **Throw normalized errors** — registry catches `{code, message, retryable}` shape and writes `reasonCode` to the audit log. Don't throw raw `Error` from handlers; throw the normalized object.
- **Preflight validation** for write tools — implement `preflight(args, ctx)` on the `ConnectorTool`. Throw `ValidationPendingError(missing, message)` so the agent re-asks the user *before* the HITL approval card is shown. This is what makes phone normalization, date normalization, and missing-required-field errors a great UX.
- **Mutate args in preflight** when normalizing inputs (phone, dates) — the registry computes idempotency from args BEFORE preflight, so post-preflight mutations don't change the key. The HITL card preview reads from the (now-canonical) args.

### Things to re-verify before declaring something "done"
1. `cd functions && npm run build` (TypeScript strict).
2. `cd functions/lib/services/connectors/__tests__ && node *.test.js` — runs `stateJwt`, `crypto`, `registry`, `dateTime`, and `phone` tests.
3. Functions emulator restarts cleanly on `lib/` change; `[CONFIRM]` / `[CONNECTOR]` lines appear in stdout when chat triggers a tool.
4. Approval card persists state across browser refresh (open chat with a resolved card, ⌘⇧R, card should stay collapsed at "done ✓" not bounce back to pending).
5. CONNECTORS_ENABLED=false path leaves orchestrator declarations identical to baseline (regression check).

### What the user is likely to ask next
- Continue building TechTrax CRM tools or fix issues that surface during testing.
- Add a third connector (Gmail / Drive / Notion / Linear were mentioned in roadmap).
- Polish the agent's tool-selection prompt so it picks the right tool more reliably across many providers.
- Eventually merge this branch into `main` once TechTrax flows are verified.

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

## Connectors — deploy + KMS commands cheat sheet

```bash
# (One-time per env, already done for staging)
gcloud config set project the-knowledge-base-staging
gcloud services enable cloudkms.googleapis.com calendar-json.googleapis.com
gcloud kms keyrings create connectors --location=us-central1
gcloud kms keys create refresh-tokens \
  --keyring=connectors --location=us-central1 --purpose=encryption
gcloud kms keys add-iam-policy-binding refresh-tokens \
  --keyring=connectors --location=us-central1 \
  --member=serviceAccount:$(gcloud projects describe the-knowledge-base-staging --format='value(projectNumber)')-compute@developer.gserviceaccount.com \
  --role=roles/cloudkms.cryptoKeyEncrypterDecrypter
openssl rand -base64 48   # → CONNECTOR_STATE_SIGNING_SECRET

# Deploy
firebase deploy --only firestore:rules --project staging
firebase deploy --only functions --project staging

# Frontend
npm run build:staging   # then your usual Netlify deploy

# Sanity check after deploy
gcloud functions list --project=the-knowledge-base-staging --regions=us-central1 \
  | grep -E 'connector|chat|getConnector|disconnect|confirmPending|cancelPending'
# Expect: connectorOAuthStart, connectorOAuthCallback, getConnectorStatus,
#         disconnectConnector, confirmPendingAction, cancelPendingAction (plus existing ones)
```

## Build Status

- **Phase 0**: Complete (scaffold)
- **Phase 1A**: Complete (auth, notebooks, file upload, source status, security rules)
- **Phase 1B**: Complete (URL ingestion, chat with streaming/citations, model selection, session reset, upload dialog with tags)
- **Phase 1C**: Complete (summarization, archive, system status/warm-up, per-notebook system prompt, token counting, RTL support, chat layout redesign, Netlify deployment)
- **Phase 2**: Complete (Telegram bot — email OTP linking, notebook/model selection, session management, rate limiting, channel-aware prompts, location support, HTML formatting)
- **Phase 3**: Complete (Web tools — Google Search, Google Maps, URL Context via slash commands /web /maps /url, per-notebook tool settings, slash command menu in web UI)
- **Phase 4**: Complete (Multimodal chat — image/audio/PDF attachments in web and Telegram, Gemini native vision/audio understanding)
- **Phase 5** (in-progress on `feat/multi-tool-orchestrator`, deployed to staging only): Multi-tool orchestrator. Parent Gemini 3 model coordinates FileSearch + 3 single-purpose sub-agents (`web_search`, `maps_search`, `url_fetch`) running on `gemini-3.1-flash-lite` via custom function declarations + `includeServerSideToolInvocations: true`. Lightweight QC, Jina URL prefetch as a pre-step, tool-call cards in the UI, blue-link styling. Gated by `MULTI_TOOL_ENABLED` env flag (`true` on staging, off on prod). Falls back to legacy single-tool path on Gemini 2.5 or when a slash command is used. Not yet merged to `main`/prod
- **Phase 6** (merged to `main`, builds on Phase 5): Connectors framework + Google Calendar. Generic provider registry, OAuth (HS256 state JWT, 10-min TTL), Cloud KMS envelope encryption for refresh tokens (AES-256-GCM with per-record DEK wrapped by KMS KEK), HITL approval gate for write actions (`pendingActions` collection + `action_approval_required` SSE event + `ActionApprovalCard` UI + `confirmPendingAction`/`cancelPendingAction` callables), per-tool audit log at `auditLogs/{id}` (90-day TTL), incremental scope authorization (read scopes at first connect → `scope_expansion_required` SSE → `mode=expand` OAuth flow → write scope on demand). Calendar tools: `gcal_freebusy`, `gcal_list_events` (read), `gcal_create_event`, `gcal_update_event`, `gcal_delete_event`, `gcal_respond_to_event` (write — HITL gated, idempotent via SHA-256 args hash, read-before-write on update/delete/RSVP). Gated by `CONNECTORS_ENABLED` (functions) and `VITE_CONNECTORS_ENABLED` (frontend). Backwards-compatible: when no connectors registered or none connected, orchestrator behavior is identical to Phase 5. KMS provisioned on staging; OAuth client + consent screen complete; E2E verified (read tools, write tools with HITL, scope expansion, mixed FileSearch + Calendar). **Merge commit**: `edf040d`.

### Phase 6 — non-obvious things learned the hard way

- **Firestore rejects `undefined`** — Calendar API responses contain optional fields (`description`, `location`) that come back undefined. Persisting them via `Timestamp.fromMillis(...)` plus result objects requires stripping `undefined` before write. `audit.ts` and `pendingActions.ts` both have a `stripUndefined` helper. CRITICAL: only recurse into plain objects (`constructor === Object`); preserve class instances like `Timestamp` — otherwise `Timestamp.toMillis()` is destroyed by re-cloning.
- **HITL state machine** — `confirmPendingAction` does NOT mark the action `approved` before executing. Goes straight from `awaiting_approval` → `executed` (or `error`) atomically inside `executeApprovedAction`. The intermediate `approved` state was redundant and broke the executor's status check.
- **Card identity across the streaming → persisted boundary** — when `streaming=false`, `StreamingMessage` unmounts and `ChatMessage` re-mounts the same card from `message.pendingActions`. Without a shared store, the card's resolution state (Confirmed / Cancelled / etc.) would reset and the UI would lie. Solved by `src/lib/connectorActionStore.ts` — module-level Map of resolutions keyed by `actionId`, subscribed via `useSyncExternalStore`. Survives unmount/remount within the same SPA session; resets only on full page reload (which is acceptable — backend `auditLogs` is the source of truth for what actually happened).
- **Never fake "executed"** — earlier iteration defaulted historical-prop cards to `state="executed"` when no runtime entry existed, which made the UI claim a confirmation that never happened. Fix: cards always derive state from runtime store OR fall back to the action's own lifecycle (`pending` if `expiresAt > now`, otherwise `expired`). No spoofed states.
- **Stale cards after page reload** — actionIds older than 5 minutes are server-side-expired. Clicking Confirm on yesterday's card returns `failed-precondition` / `deadline-exceeded`. Expected behavior; UI surfaces the error.
- **`stripUndefined` and Firestore Timestamps** — see first bullet. Generic `Object.entries(...)` recursion clobbers `Timestamp` to `{seconds, nanoseconds}` without `.toMillis()`. The constructor check is load-bearing.
- **Telegram bot signature** — `routeChat` now takes `uid` + `sessionId`. `functions/src/telegram/chat.ts` was updated to pass `link.firebaseUid` + the session id; legacy single-tool path doesn't use them, but the signature must compile.

- **Phase 7** (in-progress on `feature/tech-trax-crm-connector`, builds on `main`): TechTrax CRM connector + framework-level UX hardening. Per-user credential capture via `connectTechTraxCrm` callable (no global OAuth — TechTrax uses bearer tokens minted from a per-user email/password sign-in, encrypted via the same KMS envelope). 7 tools: `crm_list_stages`, `crm_list_leads`, `crm_get_lead` (read), `crm_create_lead`, `crm_update_lead`, `crm_transition_stage`, `crm_assign_lead` (write — HITL gated). Schema cache at `users/{uid}/connectors/tech_trax_crm/_schema/v1` (1-hour TTL) maps custom-field names → fieldIds for routing agent inputs. Joi-aware preflight validation (`validateCreate`, `validateTransition`) surfaces missing mandatory fields as `ValidationPendingError` so the agent re-asks the user *before* the HITL approval card is shown. Optimistic locking via `If-Unmodified-Since` headers; the connector refreshes the lock token at handler start (squashes the user-think-time race) and re-captures `Last-Modified` between chained writes (PATCH then transition). Same KMS envelope encryption + audit log + HITL framework as Phase 6. Backwards-compatible: when `tech_trax_crm` provider isn't registered (no `bootConnectors()` call) or the user hasn't connected, behavior unchanged.

### Phase 7 — framework-level enhancements (apply to all connectors)

These benefit every provider — Google Calendar, TechTrax CRM, and any future ones:

- **Natural-language date parsing** (`functions/src/services/connectors/dateTime.ts`). Built on `chrono-node`. `parseDateTimeToIso(input, opts)` accepts ISO 8601 strings (pass-through), epoch ms (number), native `Date`, or natural language ("tomorrow at 4pm", "next Monday 10am", "in 2 weeks"). Default timezone `Africa/Cairo` — override per call. `dateOnly: true` for fields like `DOB` returns `YYYY-MM-DD`. Used in:
  - `google_calendar/handlers.ts` — `start.dateTime`, `end.dateTime`, `timeMin`, `timeMax`.
  - `tech_trax_crm/handlers.ts` — known date-shaped fields (`bookingDate`, `snoozeDate`, `followUpDate`, `appointmentDate`, `meetingDate` for datetime; `DOB`, `dob`, `birthDate` for date-only).
- **Phone normalization** (`functions/src/services/connectors/tech_trax_crm/phone.ts`). Built on `libphonenumber-js`. `normalizePhoneToE164(input)` parses any free-form phone string to E.164 (`+201012345678`). Default country `EG` (override per tenant later). Local Egyptian numbers like `01012345678` or `1012345678` get auto-prefixed to `+20`; international numbers (`+1 415 555 0100`) are preserved. Junk throws so the agent can re-ask. Wired into create/update lead handlers and the preflight (so the approval card preview shows the canonical number).
- **Optimistic-lock token refresh** (`tech_trax_crm/handlers.ts:refreshLockToken`). HITL approval window means preflight `Last-Modified` is 30s+ old by Confirm time → 412 `precondition_failed`. Handler refreshes the lock token via a fresh `GET /api/crm/leads/{id}` at execute time, and captures the new `Last-Modified` from each write response so chained writes don't race against themselves.
- **Persisted action state recovery on refresh** — new `getPendingActionStatus({actionId})` callable in `functions/src/index.ts`. Auth-gated, ownership-checked, read-only (never mutates the doc). Returns `{status, result, error, expiresAt}`. The frontend `ActionApprovalCard` calls it on mount when the in-memory `connectorActionStore` is empty (typical after a page refresh) and seeds the runtime state — so cards keep their resolution (`executed` / `cancelled` / `error` / `expired`) instead of falsely showing a still-clickable Confirm button.
- **Enriched 4xx error messages** (`tech_trax_crm/client.ts:enrichClientErrorMessage`). When the CRM backend returns `400 { message: "Validation error", errors: [...] }`, the helper appends the per-field `errors` / `details` / `validationErrors` reasons so the agent (and audit log, and UI) gets `"Validation error — phone: must be in international format"` instead of just `"Validation error"`.
- **`confirmPendingAction` no longer eats errors** — earlier the catch block was `err instanceof Error ? err.message : "Action execution failed."` which silently dropped registry-thrown plain-object errors (`{code, message, retryable}` shape). Now extracts `.message` from object form too AND `console.error`s the full err so emulator stdout shows `[CONFIRM] action=... tool=... failed: <real reason> { ... }`.
- **`schemaCache.normalizeStage` never emits `undefined`** — earlier it built `{color: undefined, allowedNextStages: undefined, slaHours: undefined}` for stages with missing optional fields, which Firestore rejected when caching. Now it only writes keys with defined values. Pattern to follow for any handler that returns objects to be stored: build incrementally with `if (raw.x) obj.x = raw.x` rather than always emitting `undefined`. The `stripUndefined` helpers in `audit.ts` and `pendingActions.ts` are a safety net but cleaner to never produce `undefined` in the first place.
- **`handleTransitionStage` skips empty PATCH** — when the agent passes `fieldUpdates` whose keys all route to `unrouted` (schema cache didn't recognize them), the resulting patchBody is `{}`. Backend Joi rejects with `"value must have at least 1 key"`. Handler now skips the PATCH entirely in that case, returns `fieldsDropped` in the response so the agent can re-ask, and proceeds with the transition (which then independently surfaces any real mandatoryFields gaps).

## Connectors (Phase 6 — `feat/connectors-google-calendar`)

User-authorized third-party integrations callable from chat. First connector: Google Calendar.

### Architecture

- **Generic framework** at `functions/src/services/connectors/`:
  - `registry.ts` — singleton provider registry; `dispatch(toolName, args, ctx)` for read tools (immediate exec) and write tools (HITL gate via `pendingActions`).
  - `types.ts` — `ConnectorProvider`, `ConnectorTool`, `ConnectorContext`, `EncryptedBlob`, etc.
  - `crypto.ts` — AES-256-GCM with random per-record DEK, DEK wrapped via Cloud KMS (`@google-cloud/kms`). Falls back to DEV MODE (base64) when `CONNECTOR_KMS_KEY` is unset (local emulator only).
  - `stateJwt.ts` — HS256 sign/verify for OAuth state CSRF protection. 10-minute TTL.
  - `oauth.ts` — `buildOAuthStartUrl` and `handleOAuthCallback`. Encrypts refresh + access tokens before persisting. Supports incremental authorization via `mode: 'initial' | 'expand'`.
  - `pendingActions.ts` — propose/confirm/cancel helpers backed by `pendingActions/{id}` collection (5-minute default TTL).
  - `audit.ts` — `writeAudit` to `auditLogs/{id}` with 90-day TTL field.
  - `index.ts` — `bootConnectors()` (idempotent, gated on `CONNECTORS_ENABLED=true`); registers `googleCalendarProvider`.
- **Google Calendar provider** at `functions/src/services/connectors/google_calendar/`:
  - 6 tools: `gcal_freebusy`, `gcal_list_events` (read; no approval), `gcal_create_event`, `gcal_update_event`, `gcal_delete_event`, `gcal_respond_to_event` (write; HITL gate).
  - Idempotent event IDs derived from `ctx.idempotencyKey` (registry computes a SHA-256 of `{uid, sessionId, tool, canonical(args)}` and threads it through).
  - Read-before-write on update/delete/RSVP: `events.get` first to validate existence + capture state for audit.
  - Initial scopes (read): `openid email profile calendar.readonly calendar.freebusy`. Full scopes (read+write): adds `calendar.events`. Frontend can request `mode=expand` for the writeable scope on demand.
- **Per-user OAuth tokens** at `users/{uid}/connectors/{provider}` — refresh tokens encrypted via Cloud KMS envelope; server-only via Firestore rules.
- **HITL approval gate**: write tools emit an `action_approval_required` SSE event from `/chat`; the `ActionApprovalCard` in chat renders a Confirm/Cancel UI with a 5-minute countdown; on Confirm, frontend calls `confirmPendingAction({actionId})` callable which validates ownership/status/expiry then runs the handler with the same idempotency key.
- **Audit log** at `auditLogs/{id}` covers every connector tool execution (read or write, success or error) with `{uid, sessionId, provider, tool, args, result, status, idempotencyKey, latencyMs, model, reasonCode, createdAt, ttlAt}`.
- **Incremental authorization (implemented)**: first connect requests read-only scopes (`calendar.readonly`, `calendar.freebusy`). When the agent calls a write tool and the user hasn't granted `calendar.events`, the registry returns `{kind:'scope_required', missingScopes}` (no throw). The orchestrator yields a `scope_expansion_required` SSE event AND tells Gemini to inform the user. The frontend renders a `ScopeExpansionCard` in the chat with a "Grant access" button that opens the OAuth popup with `mode=expand`. After consent, the user re-prompts and the write proceeds via the normal HITL approval flow.
- **MCP forward-compatibility**: `ConnectorTool.declaration` is JSON-Schema-shaped (matches MCP `CallToolRequest`); we can re-expose providers as MCP servers later without rewriting handlers.

### Frontend
- `/settings/connectors` page (`src/features/settings/components/ConnectorsPage.tsx`) — list of providers with Connect/Disconnect/Reconnect.
- `useConnectors` hook opens OAuth in a popup, listens for `postMessage` from the callback page.
- `ActionApprovalCard` (`src/features/chat/components/ActionApprovalCard.tsx`) and `ScopeExpansionCard` render inline under the assistant message that triggered them. They are **anchored to their turn**: when streaming finishes, the events are persisted onto `message.pendingActions` and `message.scopeExpansions` on the assistant message doc, so they stay attached to that turn (no pile-up on subsequent turns).
- Live resolution state lives in a module-level store at `src/lib/connectorActionStore.ts` (subscribed via `useSyncExternalStore`). This survives the StreamingMessage → ChatMessage unmount/remount boundary, so a card the user just confirmed still shows "Done ✓" when its hosting message re-renders from Firestore.
- Cards are fully collapsible after resolution (matching `ToolCallCard`): pending = full card with countdown + Confirm/Cancel; resolved = one-line pill with status icon, click to expand args + result.
- After page reload the runtime store is empty; cards fall back to their lifecycle (pending if `expiresAt > now`, otherwise expired). We never fake an "executed" state from persisted records — the backend `auditLogs` collection is the source of truth for what actually happened.
- `streaming.ts` handles `action_approval_required` and `scope_expansion_required` SSE events; `useChat` accumulates them per-turn and clears on `sendMessage`; `ChatMessage` renders persisted records, `StreamingMessage` renders live ones.

### Cloud Functions exports
- `connectorOAuthStart` (HTTP, requires Firebase ID token) — returns `{ url }` to the Google consent screen.
- `connectorOAuthCallback` (HTTP, public) — exchanges code, encrypts + persists tokens, posts back to opener and closes.
- `getConnectorStatus` (callable) — `{connectors: ConnectorStatus[]}` for all registered providers.
- `disconnectConnector({provider})` (callable) — best-effort `oauth2.revokeToken`, marks doc `revoked`, deletes encrypted token blobs.
- `confirmPendingAction({actionId})` (callable) — auth-gated: ownership + status + expiry checks, then `executeApprovedAction`.
- `cancelPendingAction({actionId})` (callable) — same gating, marks `cancelled` + audits.

### Firestore rules (`firestore.rules`)
Server-only deny rules added for:
- `users/{uid}/connectors/{provider}` (refresh tokens live here, even though encrypted)
- `pendingActions/{actionId}`
- `auditLogs/{logId}`

### Provisioning status (staging) — done

For `the-knowledge-base-staging`, project number `105713297964`:
- ✅ Cloud KMS API + Calendar API enabled.
- ✅ KMS keyring `connectors` (us-central1) + key `refresh-tokens` (symmetric, software protection).
- ✅ IAM: compute SA granted `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the key.
- ✅ `CONNECTOR_STATE_SIGNING_SECRET`, `CONNECTOR_KMS_KEY`, `GOOGLE_OAUTH_*` all in `functions/.env.the-knowledge-base-staging`.
- ✅ OAuth web client created in GCP; consent screen configured with all 6 scopes; test users added.
- ✅ Firestore rules deployed (deny-all on `users/{uid}/connectors/**`, `pendingActions/**`, `auditLogs/**`).
- ✅ Functions deployed: `chat`, `connectorOAuthStart`, `connectorOAuthCallback`, `getConnectorStatus`, `disconnectConnector`, `confirmPendingAction`, `cancelPendingAction`.
- ✅ `CONNECTORS_ENABLED=true` on staging.
- ✅ End-to-end verified: connect, scope expansion, freebusy/list_events reads, create_event/update_event/delete_event with HITL approval, audit log writes.

### Production rollout (when ready)

Repeat the staging steps for `the-knowledge-base-82d72`:
- New OAuth web client + consent screen on the prod GCP project (separate redirect URI: `https://us-central1-the-knowledge-base-82d72.cloudfunctions.net/connectorOAuthCallback`).
- New KMS keyring + key + IAM binding on prod.
- Generate fresh `CONNECTOR_STATE_SIGNING_SECRET` for prod env.
- **Complete Google's OAuth app verification** before going past 100 test users — `calendar` scopes are sensitive. Plan 1–4 weeks.
- `CONNECTORS_ENABLED=false` on prod until verification is done; users on prod see no connector UI.
- Firestore rules + functions deploy from `main` (after merge from `feat/connectors-google-calendar`).

## Full Requirements

See `KB-MVP-PRD.md` for complete PRD.
