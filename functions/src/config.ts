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

// --- Telegram ---

export function getTelegramBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set in functions/.env");
  return token;
}

export function getTelegramWebhookSecret(): string {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET not set in functions/.env");
  return secret;
}

export const TELEGRAM_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const TELEGRAM_DEFAULT_MODEL = "gemini-2.5-flash";

// --- Channel-specific prompt overrides ---

export const CHANNEL_PROMPT_OVERRIDES: Record<string, string> = {
  telegram: "Do NOT include inline citation markers like [1], [2] in your response. Just provide the answer directly. Keep responses concise for mobile reading. Use • or – for bullet points instead of * or -. Do not use markdown headings (###).",
};

export const WEB_TOOLS_PROMPT_ADDON = `You also have access to web tools (search, URL reading, or maps). Always prefer the user's uploaded documents first. If the uploaded sources do not contain relevant information to answer the question, or the user asks about current events, news, or topics outside their documents, use your web tools to find the answer instead. When you cannot find the answer in the uploaded sources, do NOT say you can't answer — use your web tools to help. When citing web sources, clearly distinguish them from document sources.`;

export const SUMMARIZATION_PROMPT = `Compress the following conversation into a concise summary that preserves:
- The original questions asked and their context
- Key answers, decisions, and conclusions reached
- Important facts, figures, and details from sources
- Any unresolved questions or threads

Write structured prose, not bullet points. Keep the summary as short as possible while retaining all critical information.`;
