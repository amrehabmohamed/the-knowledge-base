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

/**
 * Bucket name for admin.storage().bucket(...). Falls back to undefined which
 * means "use the project's default bucket" — works in prod where the default
 * bucket exists. In staging the default *.firebasestorage.app bucket couldn't
 * be created due to domain ownership conflict, so STORAGE_BUCKET must point at
 * the custom bucket (e.g. kb-staging-files).
 */
export function getStorageBucketName(): string | undefined {
  return process.env.STORAGE_BUCKET || undefined;
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
  "gemini-3.1-flash-lite": "gemini-3.1-flash-lite",
  "gemini-2.5-pro": "gemini-2.5-pro",
  "gemini-2.5-flash": "gemini-2.5-flash",
};

// Sub-agents always run on this lightweight Gemini 3 model — one tool, one call.
export const GEMINI_SUBAGENT_MODEL =
  process.env.GEMINI_SUBAGENT_MODEL || "gemini-3.1-flash-lite";

// Stable fallback when the user-selected model errors / is rate-limited.
export const GEMINI_FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite";

// Multi-tool orchestrator (FileSearch + custom function declarations) — gated by env.
export const MULTI_TOOL_ENABLED =
  (process.env.MULTI_TOOL_ENABLED || "false").toLowerCase() === "true";

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

// --- Connectors (OAuth + per-user external integrations) ---

export const CONNECTORS_ENABLED =
  (process.env.CONNECTORS_ENABLED || "false").toLowerCase() === "true";

function requireConnectorEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    if (CONNECTORS_ENABLED) {
      throw new Error(`${name} is required when CONNECTORS_ENABLED=true`);
    }
    return "";
  }
  return v;
}

export function getGoogleOAuthClientId(): string {
  return requireConnectorEnv("GOOGLE_OAUTH_CLIENT_ID");
}

export function getGoogleOAuthClientSecret(): string {
  return requireConnectorEnv("GOOGLE_OAUTH_CLIENT_SECRET");
}

export function getGoogleOAuthRedirectUri(): string {
  return requireConnectorEnv("GOOGLE_OAUTH_REDIRECT_URI");
}

export function getConnectorStateSigningSecret(): string {
  return requireConnectorEnv("CONNECTOR_STATE_SIGNING_SECRET");
}

export function getConnectorKmsKey(): string | undefined {
  return process.env.CONNECTOR_KMS_KEY || undefined;
}

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

// Used by the orchestrator (parent model) to describe the function-call sub-agents.
export const WEB_TOOLS_PROMPT_ADDON_V2 = `You have File Search over the user's uploaded sources, plus three callable functions:
- web_search(query): public web search via Google. Use for current events, news, or facts NOT in the uploaded sources.
- maps_search(query, latLng?): geographic search (places, addresses, POIs). Use for location-aware questions.
- url_fetch(urls[]): fetch and summarize specific URLs. Use only when the user gives URLs or you need a specific page already known.

Behavior:
- Always try File Search first. Call functions only when the answer is not in the uploaded sources, or to enrich/verify with external context.
- You MAY call multiple functions in the same turn when they cover different gaps. Each function is a single-purpose sub-agent — do not ask one to do another's job.
- Cite every claim. File Search citations and web/maps/url citations should both appear inline as [n] markers.
- If a function returns "no results" or an error, do not invent content — say what you found and what was missing.`;

export const SUMMARIZATION_PROMPT = `Compress the following conversation into a concise summary that preserves:
- The original questions asked and their context
- Key answers, decisions, and conclusions reached
- Important facts, figures, and details from sources
- Any unresolved questions or threads

Write structured prose, not bullet points. Keep the summary as short as possible while retaining all critical information.`;
