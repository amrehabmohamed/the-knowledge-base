import type { ChatCitation } from "../gemini";

export interface SubAgentResult {
  ok: boolean;
  summary: string;
  citations: ChatCitation[];
  rawTokens: number;
  reason?: string;
}

export type SubAgentName = "web_search" | "maps_search" | "url_fetch";

export type CitationVia = "web" | "maps" | "url";
