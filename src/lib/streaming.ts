import { auth } from "./firebase";
import { CHAT_FUNCTION_URL } from "@/config/constants";
import type { Citation } from "@/types/session";

export interface StreamCallbacks {
  onToken: (text: string) => void;
  onCitations: (citations: Citation[]) => void;
  onMetrics: (metrics: {
    ttftMs: number;
    totalMs: number;
    tokenCount: number;
  }) => void;
  onError: (message: string) => void;
  onDone: () => void;
}

interface ChatParams {
  notebookId: string;
  query: string;
  modelId: string;
  history: Array<{ role: string; content: string }>;
  sessionId?: string;
  toolOverride?: string;
}

/**
 * Streams a chat response from the backend SSE endpoint.
 */
export async function streamChat(
  params: ChatParams,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    callbacks.onError("Not authenticated.");
    return;
  }

  const response = await fetch(CHAT_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    callbacks.onError(`Chat request failed (${response.status}).`);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError("No response body.");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events (separated by \n\n)
      const events = buffer.split("\n\n");
      // Keep the last incomplete chunk in the buffer
      buffer = events.pop() ?? "";

      for (const eventStr of events) {
        if (!eventStr.trim()) continue;

        const lines = eventStr.split("\n");
        let eventType = "";
        let data = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ")) {
            data = line.slice(6);
          }
        }

        if (!eventType || !data) continue;

        try {
          const parsed = JSON.parse(data);

          switch (eventType) {
            case "token":
              callbacks.onToken(parsed.text ?? "");
              break;
            case "citations":
              callbacks.onCitations(parsed.citations ?? []);
              break;
            case "metrics":
              callbacks.onMetrics(parsed);
              break;
            case "done":
              callbacks.onDone();
              break;
            case "error":
              callbacks.onError(parsed.message ?? "Unknown error.");
              break;
          }
        } catch {
          // Skip malformed events
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
