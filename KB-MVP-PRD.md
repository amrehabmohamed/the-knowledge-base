# Personal Knowledge Base - MVP PRD

| Field | Value |
|-------|-------|
| Author | Grand Master |
| Status | Draft |
| Version | v0.4 |
| Last Updated | March 19, 2026 |
| Change Log | v0.1 - Initial draft. v0.2 - Single store, response metrics, summarization threshold to 500K, warm-up feature. v0.3 - PM Toolkit review fixes: model selection, session archive, dependency list, scenario cleanup. v0.4 - Final readiness pass: removed token ceiling, Gemini 3 default, inline Jina error table, Phase 0 bootstrap, typography |

**Inspired by:** Google NotebookLM
**Stack:** React (prompt-kit + shadcn) | GCP (Firestore, Cloud Storage, Cloud Functions) | Firebase Auth | Gemini FileSearch | Jina Reader
**Deployment:** Netlify free tier via GitHub
**Dev Tool:** Claude Code

---

## Problem Statement

I need a single place to upload documents and URLs, ask questions grounded in my own content, and get cited answers I can verify. Existing tools are either too limited (NotebookLM's source caps), too complex (building full RAG from scratch), or not customizable enough. This app gives me a NotebookLM-like experience I fully own, with room to grow into a multi-agent orchestrator.

## Goals

1. Upload files and URLs as sources, query them with Gemini FileSearch, and get cited answers
2. Organize sources into notebooks/collections for topical separation
3. Persistent chat with session memory and automatic summarization
4. Foundation architecture that supports adding an orchestrator agent in phase 2
5. Deployed and usable as a daily tool, not a prototype

## Non-Goals (MVP)

1. Multi-user collaboration or sharing (single user, Firebase Auth for access control only)
2. Audio/video overviews, mind maps, infographics, slide generation (NotebookLM extras, future)
3. Custom embedding model or custom RAG pipeline (using managed FileSearch)
4. Mobile-native app (responsive web is sufficient)
5. Billing, plans, or usage quotas (personal project, no monetization)
6. Orchestrator agent and sub-agents (phase 2)

---

## Architecture Overview

```
[Netlify - React SPA]
        |
        v
[Firebase Auth] --> [Cloud Functions (API layer)]
                            |
              +-------------+-------------+
              |             |             |
        [Firestore]   [Cloud Storage]  [Gemini FileSearch API]
        (metadata,    (original files,  (indexing, retrieval,
         sessions,    extracted URLs)    generation)
         chat history)
                                         |
                                    [Jina Reader]
                                    (URL extraction)
```

### Data Model (Firestore)

**config** (singleton document)
```
{
  geminiStoreId: string (single Gemini FileSearch store ID for entire app)
  geminiProjectId: string
  createdAt: timestamp
}
```

**notebooks** collection
```
{
  id: string (auto)
  name: string
  description: string
  createdAt: timestamp
  updatedAt: timestamp
}
```

**sources** collection (subcollection of notebooks)
```
{
  id: string (auto)
  notebookId: string
  type: "file" | "url"
  displayName: string
  originalUrl: string | null
  storageRef: string (Cloud Storage path)
  geminiDocId: string (Gemini document ID)
  fileType: string
  sizeBytes: number | null
  status: "fetching" | "uploading" | "pending" | "indexing" | "ready" | "failed"
  failureReason: string | null
  tags: { key: string, value: string }[]
  createdAt: timestamp
  updatedAt: timestamp
}
```

**sessions** collection (one active session per notebook at a time)
```
{
  id: string (auto)
  notebookId: string
  status: "active" | "archived"
  totalTokens: number
  modelId: string (e.g., "gemini-3-flash", selected at query time)
  createdAt: timestamp
  updatedAt: timestamp
  archivedAt: timestamp | null
}
```

**messages** subcollection (under sessions)
```
{
  id: string (auto)
  sessionId: string
  role: "user" | "assistant" | "summary"
  content: string
  citations: {
    index: number
    sourceId: string
    sourceName: string
    chunkText: string
  }[] | null
  tokenCount: number
  modelId: string | null (model used for this response, null for user messages)
  agentType: string (default: "filesearch", reserved for Phase 2 orchestrator)
  metrics: {
    ttftMs: number (time to first token in milliseconds)
    totalMs: number (total response time in milliseconds)
  } | null (null for user/summary messages)
  createdAt: timestamp
}
```

**response_metrics** collection (flat, for analytics)
```
{
  id: string (auto)
  sessionId: string
  notebookId: string
  messageId: string
  ttftMs: number
  totalMs: number
  tokenCount: number
  sourceCount: number (number of sources queried)
  createdAt: timestamp
}
```

---

## User Stories

### Phase 1: Core Foundation

#### US-001: Notebook Creation and Management

**As a** user,
**I want** to create notebooks to organize my sources by topic,
**So that** I can keep different knowledge domains separate and query them independently.

**Acceptance Criteria:**

**Scenario 1: Create a new notebook**
- Given I am on the home screen
- When I create a new notebook with a name and optional description
- Then the notebook is created in Firestore and appears in my list

**Scenario 2: View notebook list**
- Given I have one or more notebooks
- When I view the home screen
- Then I see all notebooks with their name, description, source count, and last activity date

**Scenario 3: Delete a notebook**
- Given I have a notebook
- When I confirm deletion
- Then the notebook and all its sources are permanently removed
- And any active chat session for this notebook is archived before deletion

**Requirements:**
1. Single GCP project, single Gemini FileSearch store for the entire app. The store is pre-created during initial setup, not per notebook
2. Notebook isolation is achieved via Gemini custom metadata: every document uploaded includes a `notebookId` metadata field. Queries filter by this field
3. Notebook names must be unique per user
4. Deletion is permanent with a confirmation dialog. Deletion removes all sources whose metadata matches the notebook ID from Gemini and Cloud Storage
5. If an active session exists for the notebook being deleted, it is archived (status set to "archived") before the notebook is removed

---

#### US-002: File Upload

**Gemini API Reference:** [File Search - Upload](https://ai.google.dev/gemini-api/docs/file-search#upload)

**As a** user,
**I want** to upload files as sources to a notebook,
**So that** I can query my documents through the KB chat.

**Acceptance Criteria:**

**Scenario 1: Successful single file upload with real-time status**
- Given I have a supported file under 50 MB
- When I upload the file
- Then the source appears in the panel and I can follow its progress until it is ready or shows an error

**Scenario 2: Successful batch upload (up to 10 files)**
- Given I have up to 10 supported files
- When I upload the batch
- Then each file appears with its own status indicator and any single failure does not block the rest

**Scenario 3: Upload rejected before transfer**
- Given I have selected files that do not pass validation
- When I attempt to upload
- Then each invalid file is rejected with a specific, actionable error before any data is transferred

**Scenario 4: Processing failure is recoverable**
- Given a source is being processed
- When processing fails
- Then the source shows a failed status with a retry option

**Scenario 5: Chat activates when the first source reaches ready**
- Given the notebook has no ready sources
- When a source finishes processing
- Then it is automatically selected and I can begin querying

**Requirements:**
1. Supported file types (per Gemini FileSearch): PDF, DOCX, PPTX, XLSX, TXT, MD, HTML, XML, JSON, YAML, JSONL, CSV, TSV, PY, JS, TS, JAVA, C, CPP, CS, GO, RB, PHP, SH, R, SQL
2. Max file size: 50 MB per file
3. Upload pipeline: file goes to Cloud Storage first, then Cloud Storage path is passed to Gemini for indexing
4. Every file uploaded to Gemini includes custom metadata: notebook ID
5. Files in a batch are processed sequentially through a per-notebook queue. Smaller files first
6. Pre-upload validation: unsupported type, exceeds 50 MB, duplicate filename in notebook
7. Source status flow: uploading -> pending -> indexing -> ready | failed
8. Gemini retry behavior follows Document State lifecycle (pending, active, failed)

---

#### US-003: URL Ingestion

**Jina Reader Reference:** [Jina Reader API](https://jina.ai/reader/)

**As a** user,
**I want** to add web pages as sources,
**So that** I can query external content alongside my uploaded files.

**Acceptance Criteria:**

**Scenario 1: Successful URL ingestion**
- Given I have a publicly accessible URL
- When I submit the URL
- Then I see the source progress through fetching -> uploading -> pending -> indexing -> ready
- And the source appears with the page title as its display name

**Scenario 2: URL fails with a permanent error**
- Given a URL that is unreachable, blocked, requires auth, or has no readable content
- When I submit it
- Then the source shows an error identifying the specific failure reason, with a retry option

**Scenario 3: URL rejected as duplicate**
- Given a URL already exists in this notebook
- When I submit the same URL
- Then the submission is rejected with a duplicate error

**Requirements:**
1. Jina Reader is behind an abstraction layer (swappable later)
2. Full flow: fetch via Jina -> save extracted .md to Cloud Storage -> submit to Gemini for indexing
3. Timeout: 60 seconds for URL fetch
4. Display name: page title from Jina, fallback to raw URL
5. URL uniqueness: raw URL is the key per notebook
6. Single URL submission at launch (no batch)
7. Same per-notebook queue as file uploads
8. Error mapping from Jina response codes:
   - HTTP 200 + `data.warning` contains "returned error 404" -> "Page not found. Check the URL and try again."
   - HTTP 200 + `data.warning` contains "returned error 403" -> "This page could not be accessed. It may be blocked or behind a firewall."
   - HTTP 200 + `data.content` empty or < 50 chars -> "No readable content could be extracted from this page."
   - HTTP 422 -> "This page requires login or a subscription. Only publicly accessible pages are supported."
   - HTTP 429 -> "Too many requests. Please try again in a moment."
   - No response within 60s -> "The page took too long to load. Try again or use a different URL."
   - HTTP 503 -> "URL processing service is temporarily unavailable. Please try again shortly."
   - Extracted markdown > 50 MB -> "The extracted content from this URL exceeds the file size limit."

---

#### US-004: Source Management

**As a** user,
**I want** to view, tag, preview, and delete sources,
**So that** I can keep my notebook organized and current.

**Acceptance Criteria:**

**Scenario 1: Source panel displays all sources**
- Given I have sources in a notebook
- When I view the source panel
- Then I see each source with: name, type icon, status, tags, and upload date

**Scenario 2: Tag a source during upload**
- Given I am adding a new source
- When I add key-value tags (up to 10)
- Then the tags are saved with the source and visible on the source card
- And tags are sent to Gemini as custom metadata

**Scenario 3: Preview a source**
- Given I have a ready source
- When I trigger preview
- Then browser-renderable types (PDF, text, HTML, markdown) render inline; binary types show a download link
- And URL sources render extracted markdown with the original URL clickable

**Scenario 4: Download a source**
- Given I have a ready source
- When I trigger download
- Then file sources download the original file; URL sources download the extracted .md

**Scenario 5: Delete a source**
- Given a source is in ready or failed state
- When I confirm deletion
- Then it is removed from Gemini, deleted from Cloud Storage, and removed from the source panel

**Scenario 6: Delete blocked during processing**
- Given a source is being processed
- Then the delete action is not available

**Requirements:**
1. Tags: key-value pairs, max 10 per source, immutable after creation, key max 256 chars, value max 2048 chars
2. Tags sent to Gemini as custom metadata (notebook ID occupies 1 slot, leaving 19 for user tags, using 10 max)
3. Deletion pipeline: Gemini removal first, then Cloud Storage. If Gemini fails, abort
4. Source selection: at least one source must be selected when ready sources exist
5. Real-time status updates via Firestore listeners (no polling)

---

#### US-005: Chat with Citations and Memory

**Gemini API Reference:** [File Search - Structured Output](https://ai.google.dev/gemini-api/docs/file-search#structured-output)

**As a** user,
**I want** to query my sources and get grounded answers with citations,
**So that** I can verify AI accuracy against my content.

**Acceptance Criteria:**

**Scenario 1: Query streams with citation markers and performance metrics**
- Given I have at least one ready source selected
- When I submit a query
- Then the response streams with first content appearing immediately
- And numbered citation markers appear at grounded positions
- And the query and response are appended to conversation history
- And two small numbers appear below the response: TTFT (time to first token) and total response time, both in seconds

**Scenario 2: Citation panel shows source details**
- Given a response contains citation markers
- When I click a citation
- Then a panel shows: source name, type, upload date, tags, and the excerpt from that source

**Scenario 3: Conversation persists across sessions**
- Given I have had multiple exchanges
- When I close and reopen the app
- Then my full conversation history is restored

**Scenario 4: Streaming interruption**
- Given I submit a query and the stream is interrupted
- Then any content received is shown with an error indicator and a retry option
- And existing conversation history remains intact

**Scenario 5: Reset archives current session and starts fresh**
- Given I trigger a reset
- Then the current session is archived (accessible later from Settings > Archive)
- And conversation history is cleared from the chat view
- And a fresh session begins with zero token count
- And selected sources remain unchanged

**Scenario 6: Select chat model**
- Given I am in a notebook chat
- When I select a different Gemini model from the model selector
- Then subsequent queries use the selected model
- And the model choice is persisted for this session

**Requirements:**
1. Every query includes the notebook ID as metadata filter
2. Chat input disabled while a response is streaming (one query at a time)
3. Queries scoped to currently selected sources within the notebook
4. Always use streaming for responses
5. No hard session ceiling. Summarization at 500K tokens (US-006) keeps context manageable indefinitely. Users can still manually reset at any time
6. Citation data stored at response time, not fetched live
7. If Gemini returns no grounding data, response renders without citations (no fabrication)
8. Reset archives the current session (status: "archived", archivedAt: timestamp) and creates a new active session. Archived sessions and their messages remain in Firestore
9. System prompt: define a base persona for the KB assistant (helpful, grounded, cites sources, admits uncertainty)
10. Response performance metrics: every assistant response records TTFT (time from query submission to first streamed token) and total response time (time from query submission to stream completion). Both are measured client-side in milliseconds, displayed to the user in seconds (e.g., "TTFT: 0.8s | Total: 3.2s"), and stored both on the message document and in a dedicated `response_metrics` collection for future analytics
11. Metrics are displayed as subtle, small text below each assistant response. Historical messages loaded from Firestore also show their stored metrics
12. Model selection: a dropdown in the chat header allows choosing the Gemini model for generation. Default: Gemini 3 Flash. Available models: Gemini 3 Pro, Gemini 3 Flash, Gemini 2.5 Pro, Gemini 2.5 Flash. The selected model ID is stored on the session and on each assistant message. Model can be changed mid-session; each response records which model generated it
13. Summarization always uses Gemini 2.5 Flash regardless of the chat model selection

---

#### US-006: Token-Based Summarization

**As a** user,
**I want** long conversations to be automatically summarized to maintain quality,
**So that** I can have extended research sessions without degraded responses.

**Acceptance Criteria:**

**Scenario 1: Summarization at threshold**
- Given a session whose token count reaches 500,000
- When the next query is received
- Then the session context is compressed into a summary
- And the query proceeds against the summary plus subsequent turns

**Scenario 2: Re-summarization**
- Given a previously summarized session hits the threshold again
- When the next query is received
- Then a new summary replaces the old one

**Scenario 3: Summarization fails**
- Given summarization fails after retries
- Then the session continues without compression
- And summarization is retried on the next query after a 1-minute cooldown

**Requirements:**
1. Summarization threshold: 500,000 tokens (configurable in app config)
2. One active summary per session at any time
3. Summary preserves: original question context, key answers and decisions, important details
4. Summarization model: Gemini 2.5 Flash (plain completion call, no FileSearch tool)
5. Replaced summaries retained in Firestore but excluded from active context
6. Summarization executes synchronously before the triggering query
7. Summarization tokens count toward session total

---

#### US-007: System Status and "Start Your Engines" Warm-Up

**As a** user,
**I want** to see whether the backend is warm or cold and trigger a warm-up manually,
**So that** I get fast responses when I'm ready to work instead of waiting through cold starts.

**Acceptance Criteria:**

**Scenario 1: System status reflects backend state**
- Given I open the app
- When the frontend loads
- Then a system status indicator shows the current backend state: "Ready" (warm), "Sleeping" (cold/unknown), or "Warming Up" (in progress)

**Scenario 2: Manual warm-up trigger**
- Given the system status shows "Sleeping"
- When I click "Start Your Engines"
- Then a lightweight ping is sent to all critical Cloud Functions
- And the status transitions to "Warming Up" with a brief animation
- And once all functions respond, the status shows "Ready"

**Scenario 3: Warm-up fails**
- Given I trigger a warm-up
- When one or more functions fail to respond within 30 seconds
- Then the status shows "Partially Ready" or "Sleeping" depending on which functions responded
- And I can retry

**Scenario 4: Auto-detect warm state on first interaction**
- Given I open the app and immediately perform an action (upload, query, etc.)
- When the action completes successfully
- Then the status updates to "Ready" without requiring a manual warm-up

**Requirements:**
1. Each Cloud Function exposes a lightweight `/ping` or `warmup=true` handler that returns immediately with minimal processing, used solely to keep the instance alive
2. The frontend pings all critical functions on app load to check state. If response time is under 500ms, the function is warm. Over 500ms or timeout means cold
3. "Start Your Engines" sends parallel pings to all Cloud Functions. Status updates in real-time as each function responds
4. Status indicator is always visible in the app header/nav, small and non-intrusive
5. Status states: "Ready" (green), "Sleeping" (gray), "Warming Up" (amber, animated), "Partially Ready" (yellow)
6. Warm-up ping responses are not logged to `response_metrics` since they are not user queries

---

#### US-008: Session Archive

**As a** user,
**I want** to browse and read my archived chat sessions,
**So that** I can revisit past research and conversations without losing them on reset.

**Acceptance Criteria:**

**Scenario 1: View archived sessions**
- Given I have one or more archived sessions
- When I navigate to Settings > Archive
- Then I see a list of archived sessions sorted by archive date (newest first)
- And each entry shows: notebook name, archive date, message count, and total tokens used

**Scenario 2: Read an archived session**
- Given I am viewing the archive list
- When I select an archived session
- Then I see the full conversation history in read-only mode
- And citations are visible and clickable (showing stored snapshot data)
- And performance metrics are displayed on each response

**Scenario 3: No archived sessions**
- Given I have no archived sessions
- When I navigate to Settings > Archive
- Then I see an empty state with guidance that sessions are archived on reset

**Requirements:**
1. Archived sessions are read-only. No querying, editing, or resuming
2. Archive list is paginated (20 sessions per page) to avoid loading all history at once
3. Citations in archived sessions use stored snapshot data. If the source has since been deleted, the snapshot renders with a note that the source is no longer available
4. Archive is accessible from Settings > Archive. Visible to the authenticated user only
5. No delete or bulk-delete for archived sessions in MVP. Future consideration

---

### Phase 2: Orchestrator Foundation (Architecture Only)

#### US-009: Orchestrator Agent Architecture

**As a** user,
**I want** a foundation for adding specialized agents behind an orchestrator,
**So that** I can extend my knowledge base with capabilities beyond simple RAG.

**Requirements (Architecture Prep, Not Implementation):**
1. The FileSearch agent from Phase 1 must be wrapped in a clean interface: input (query + context) -> output (response + citations)
2. Cloud Functions should be structured so each agent is a separate function or module
3. The chat layer should support routing: a future orchestrator function receives the query and decides which agent(s) to invoke
4. Agent responses should follow a common schema so the frontend doesn't need to know which agent answered
5. The Firestore session model should support a `agentType` field on messages for future use
6. No orchestrator UI or logic is built in Phase 1; this story is about structural decisions only

---

## Tech Stack Detail

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React + Vite | SPA framework |
| UI Components | prompt-kit + shadcn/ui + Tailwind | Chat UI + general components |
| Typography | Outfit (headings, UI labels) + Urbanist (body, chat) | Google Fonts, free |
| Auth | Firebase Auth | Login, session management |
| Database | Cloud Firestore | Source registry, sessions, chat history, notebooks |
| File Storage | Cloud Storage | Original files, extracted URL content |
| Backend Logic | Cloud Functions (Node.js) | API layer, Gemini calls, Jina calls, upload pipeline |
| RAG | Gemini FileSearch API | Indexing, retrieval, generation |
| URL Extraction | Jina Reader API | Web page content extraction |
| Hosting | Netlify (free tier) | Frontend deployment via GitHub |
| Dev Tool | Claude Code | All implementation |

---

## Dependencies & Prerequisites

Before Claude Code can start building, these must be in place:

1. **GCP Project:** A single GCP project with billing enabled (free tier). Enable APIs: Firestore, Cloud Storage, Cloud Functions, Firebase Auth, Gemini API
2. **Gemini API Key:** API key with FileSearch access. Determine your usage tier (Free: 1 GB store, Tier 1: 10 GB store)
3. **Jina Reader API Key:** Free key from [jina.ai](https://jina.ai/reader/) (10M tokens included)
4. **Firebase Auth Setup:** At minimum, email/password auth enabled for single-user login
5. **GitHub Repository:** For Netlify deployment via GitHub integration
6. **Netlify Account:** Free tier, connected to the GitHub repo
7. **Node.js 20+:** Cloud Functions runtime
8. **prompt-kit:** Install via npm. Chat UI components built on shadcn/ui. See [prompt-kit.com](https://www.prompt-kit.com/) for setup instructions. Requires shadcn/ui and Tailwind CSS as peer dependencies
9. **Typography:** Outfit and Urbanist from Google Fonts. Outfit for headings, navigation, buttons, and UI labels. Urbanist for body text, chat messages, and source panel content. Load via `@fontsource/outfit` and `@fontsource/urbanist` npm packages or Google Fonts CDN. Configure in Tailwind as `fontFamily: { heading: ['Outfit', 'sans-serif'], body: ['Urbanist', 'sans-serif'] }`
10. **GCP MCP Server:** Install locally for Claude Code to manage GCP resources directly

---

## Implementation Phases

### Phase 0: Bootstrap (One-Time Setup)
- Create GCP project, enable all required APIs
- Create a single Gemini FileSearch store via the API and record the store ID
- Write the `config` singleton document to Firestore with `geminiStoreId` and `geminiProjectId`
- Set up Firebase Auth with email/password
- Create GitHub repo, connect to Netlify
- Initialize React + Vite project with prompt-kit, shadcn/ui, Tailwind, Outfit, and Urbanist

### Phase 1A: Foundation (Build First)
1. Notebook CRUD (Firestore only, no per-notebook store provisioning)
2. File upload pipeline (Cloud Storage -> Gemini indexing with notebook ID metadata)
3. Source panel with real-time status

### Phase 1B: Content & Chat
4. URL ingestion via Jina Reader
5. Source tagging, preview, download, deletion
6. Chat with streaming, citations, session memory, model selection, and manual reset

### Phase 1C: Polish
8. Summarization
9. Session archive (Settings > Archive)
10. System status indicator and "Start Your Engines" warm-up
11. Frontend deployment to Netlify
12. System prompt tuning and response quality testing

### Phase 2: Orchestrator (Future)
13. Agent interface abstraction
14. Orchestrator routing logic
15. Additional specialized agents (TBD)

---

## Resolved Questions

### 1. Gemini FileSearch Store Limits
**Source:** [Gemini FileSearch Docs](https://ai.google.dev/gemini-api/docs/file-search)

| Tier | Total Store Size |
|------|-----------------|
| Free | 1 GB |
| Tier 1 | 10 GB |
| Tier 2 | 100 GB |
| Tier 3 | 1 TB |

Key details: max file size is 100 MB per document. Store size is calculated as ~3x input data (input + generated embeddings). Google recommends keeping individual stores under 20 GB for optimal retrieval. No explicit max document count per store documented. With 500 MB of personal data, even accounting for the 3x multiplier (~1.5 GB), Tier 1 (10 GB) covers this comfortably.

### 2. Jina Reader Free Tier
**Source:** [Jina Reader API](https://jina.ai/reader/)

Every new API key gets 10 million free tokens. Free tier rate limits: 100 RPM (requests per minute), 100K TPM (tokens per minute), 2 concurrent requests. No explicit monthly cap beyond the initial 10M token grant. For a personal project with occasional URL ingestion, the free tier is more than enough. If the 10M token grant runs out, paid pricing is token-based.

### 3. Cloud Functions Cold Starts - "Start Your Engines" Feature
**Source:** [Cloud Functions Best Practices](https://cloud.google.com/functions/docs/bestpractices/tips)

Cloud Functions instances are recycled after ~15 minutes of inactivity. Cold starts can add 1-10 seconds depending on function size. Rather than paying for minimum instances, the app will implement a system status indicator with a manual warm-up trigger. See US-007 below.

### 4. NotebookLM-Inspired Features
Deferred. Will decide based on actual usage patterns after MVP ships.

### 5. Orchestrator Sub-Agents
Deferred to Phase 2. Will define based on real needs after using the MVP.
