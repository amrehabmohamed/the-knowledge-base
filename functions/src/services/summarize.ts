import { GoogleGenAI } from "@google/genai";
import {
  getGeminiApiKey,
  SUMMARIZATION_MODEL,
  SUMMARIZATION_PROMPT,
} from "../config";

let genaiClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!genaiClient) {
    genaiClient = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  }
  return genaiClient;
}

interface SummarizationResult {
  summary: string;
  tokenCount: number;
}

/**
 * Summarizes a conversation using Gemini 2.5 Flash (plain completion, no FileSearch).
 * Retries up to 2 times with exponential backoff on failure.
 */
export async function summarizeSession(
  messages: Array<{ role: string; content: string }>
): Promise<SummarizationResult> {
  const client = getClient();

  const conversationText = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.models.generateContent({
        model: SUMMARIZATION_MODEL,
        contents: [
          {
            role: "user",
            parts: [{ text: `${SUMMARIZATION_PROMPT}\n\n---\n\n${conversationText}` }],
          },
        ],
      });

      const summary = response.text ?? "";
      const tokenCount =
        response.usageMetadata?.totalTokenCount ??
        Math.ceil(summary.length / 4);

      return { summary, tokenCount };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * Math.pow(2, attempt))
        );
      }
    }
  }

  throw lastError ?? new Error("Summarization failed after retries");
}
