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
}

export interface MessageMetrics {
  ttftMs: number;
  totalMs: number;
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
  superseded?: boolean;
  createdAt: Timestamp;
}
