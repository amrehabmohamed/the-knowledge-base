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

export const SYSTEM_PROMPT = `You are a knowledgeable research assistant for a personal knowledge base.
Your responses must be grounded in the provided sources.
Always cite your sources using numbered markers [1], [2], etc.
If you cannot find relevant information in the sources, say so honestly.
Do not fabricate information or citations.
Be concise but thorough. Use markdown formatting for clarity.`;
