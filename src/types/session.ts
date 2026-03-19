import type { Timestamp } from "firebase/firestore";

export interface Session {
  id: string;
  notebookId: string;
  status: "active" | "archived";
  totalTokens: number;
  modelId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  archivedAt: Timestamp | null;
}

export interface Citation {
  index: number;
  sourceId: string;
  sourceName: string;
  chunkText: string;
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
  createdAt: Timestamp;
}
