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
  superseded?: boolean;
  createdAt: Timestamp;
}
