import type { Timestamp } from "firebase/firestore";

export interface Session {
  id: string;
  notebookId: string;
  status: "active" | "archived";
  totalTokens: number;
  messageCount: number;
  modelId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  archivedAt: Timestamp | null;
  lastSummarizationFailedAt?: Timestamp | null;
  /**
   * Cached prefix for the Gemini orchestrator (model + system prompt + tools),
   * keyed per session and refreshed on each turn. Managed by the backend.
   */
  geminiCache?: {
    name: string;
    hash: string;
    expiresAt: number;
  } | null;
}

export interface Citation {
  index: number;
  sourceId: string;
  sourceName: string;
  chunkText: string;
  type?: "source" | "web";
  url?: string;
  via?: "web" | "maps" | "url";
}

/**
 * A tool invocation surfaced to the UI — covers Jina URL prefetch and the
 * orchestrator's sub-agent dispatches (web_search, maps_search, url_fetch).
 */
export interface ToolCall {
  id: string;
  name: string;
  /** What was passed to the tool (best-effort: search query, urls, etc.) */
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  /** Final summary text produced by the tool (when status === "done") */
  output?: string;
  /** Citations the tool produced (when status === "done") */
  citations?: Citation[];
  /** Error reason (when status === "error") */
  error?: string;
  /** Wall-clock duration in ms (set when status transitions to done/error) */
  durationMs?: number;
  startedAt: number;
  /**
   * True when this is the orchestrator's HITL *proposal* — the actual write
   * runs later via confirmPendingAction and is recorded as a separate
   * `hitl_executed` synthetic assistant message. Backend history-replay skips
   * these to avoid the agent seeing the same logical write twice.
   */
  awaitingApproval?: boolean;
}

export interface MessageMetrics {
  ttftMs: number;
  totalMs: number;
}

export interface Attachment {
  type: "image" | "audio" | "pdf";
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  storageRef: string;
  downloadUrl: string;
}

/**
 * A pending HITL action emitted by a connector tool. Persisted on the
 * assistant message doc so the actionId survives reload (current state must
 * be re-fetched from backend on load — for v1 we only persist the id and
 * basic metadata).
 */
export interface PendingActionRecord {
  actionId: string;
  provider: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  expiresAt: number;
}

export interface ScopeExpansionRecord {
  provider: string;
  tool: string;
  missingScopes: string[];
}

/**
 * A clarification ask emitted by the orchestrator's `ask_user` control tool.
 * Persisted on the assistant message doc so the form survives reload (resolution
 * state itself lives in `clarificationStore` for v1).
 */
export interface ClarificationQuestionRecord {
  key: string;
  prompt: string;
  type: "text" | "date" | "select";
  options?: Array<{ id: string; label: string }>;
  required?: boolean;
}

export interface ClarificationRecord {
  clarificationId: string;
  reason: string;
  questions: ClarificationQuestionRecord[];
}

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "summary";
  content: string;
  citations: Citation[] | null;
  tokenCount: number;
  modelId: string | null;
  agentType: string;
  metrics: MessageMetrics | null;
  attachments?: Attachment[] | null;
  toolCalls?: ToolCall[] | null;
  pendingActions?: PendingActionRecord[] | null;
  scopeExpansions?: ScopeExpansionRecord[] | null;
  clarifications?: ClarificationRecord[] | null;
  superseded?: boolean;
  createdAt: Timestamp;
}
