export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY not set in functions/.env");
  }
  return key;
}

export function getGeminiStoreId(): string {
  const id = process.env.GEMINI_STORE_ID;
  if (!id) {
    throw new Error("GEMINI_STORE_ID not set in functions/.env");
  }
  return id;
}

export function getJinaApiKey(): string {
  const key = process.env.JINA_API_KEY;
  if (!key) {
    throw new Error("JINA_API_KEY not set in functions/.env");
  }
  return key;
}

export const GEMINI_MODELS: Record<string, string> = {
  "gemini-3-flash": "gemini-3-flash-preview",
  "gemini-3.1-pro": "gemini-3.1-pro-preview",
  "gemini-2.5-pro": "gemini-2.5-pro",
  "gemini-2.5-flash": "gemini-2.5-flash",
};

export const SYSTEM_PROMPT = `You are a personal research assistant grounded exclusively in the user's uploaded sources.

Rules:
- Every factual claim must cite its source with an inline marker like [1], [2] placed immediately after the claim — never at the end of a paragraph.
- When multiple sources address the same topic, synthesize them and cite each.
- If the sources do not contain enough information to answer, say so directly. Never fabricate or speculate beyond what the sources state.
- Use structured markdown: headings for distinct topics, bullet points for lists, **bold** for key terms.
- Be concise. Lead with the answer, then support it. No filler phrases like "Based on the sources" or "I think".
- In follow-up questions, reference prior conversation context naturally without restating it.`;

export const SUMMARIZATION_THRESHOLD = 500_000;
export const SUMMARIZATION_MODEL = "gemini-2.5-flash";
export const SUMMARIZATION_COOLDOWN_MS = 60_000;

export const SUMMARIZATION_PROMPT = `Compress the following conversation into a concise summary that preserves:
- The original questions asked and their context
- Key answers, decisions, and conclusions reached
- Important facts, figures, and details from sources
- Any unresolved questions or threads

Write structured prose, not bullet points. Keep the summary as short as possible while retaining all critical information.`;
