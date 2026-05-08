import { GoogleGenAI, type Content } from "@google/genai";
import * as admin from "firebase-admin";
import {
  getGeminiApiKey,
  getGeminiStoreId,
  GEMINI_MODELS,
  SYSTEM_PROMPT,
  CHANNEL_PROMPT_OVERRIDES,
  WEB_TOOLS_PROMPT_ADDON,
  MULTI_TOOL_ENABLED,
  getStorageBucketName,
} from "../config";
import { orchestrate } from "./orchestrator";
import {
  extractUrlsFromText,
  prefetchUrls,
  renderPrefetchBlock,
} from "./urlPrefetch";

let genaiClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!genaiClient) {
    genaiClient = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  }
  return genaiClient;
}

/**
 * Uploads a file directly to the FileSearch Store with custom metadata.
 * Uses the single-step uploadToFileSearchStore API.
 * Returns the store document name (e.g. "fileSearchStores/xxx/documents/yyy").
 */
export async function uploadToGeminiStore(
  storageRef: string,
  mimeType: string,
  displayName: string,
  metadata: Record<string, string>
): Promise<string> {
  const client = getClient();
  const storeId = getGeminiStoreId();

  // Download file from Cloud Storage
  const bucket = admin.storage().bucket(getStorageBucketName());
  const file = bucket.file(storageRef);
  const [buffer] = await file.download();

  // Build custom metadata from all key-value pairs (notebookId + user tags)
  const customMetadata: Array<{ key: string; stringValue: string }> = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (key && value) {
      customMetadata.push({ key, stringValue: value });
    }
  }

  console.log(`[UPLOAD] storageRef=${storageRef}, displayName=${displayName}`);
  console.log(`[UPLOAD] storeId=${storeId}`);
  console.log(`[UPLOAD] customMetadata=${JSON.stringify(customMetadata)}`);

  // Upload directly to the FileSearch Store (single step)
  const uint8 = new Uint8Array(buffer);
  const blob = new Blob([uint8], { type: mimeType });

  const operation = await client.fileSearchStores.uploadToFileSearchStore({
    file: blob,
    fileSearchStoreName: storeId,
    config: {
      displayName,
      customMetadata,
    },
  });

  // Extract document name from operation response
  const response = operation.response as Record<string, unknown> | undefined;
  const documentName = (response?.documentName as string) ?? "";

  console.log(`[UPLOAD] operation response: ${JSON.stringify(response)}`);

  if (!documentName) {
    console.warn("[UPLOAD] WARNING: Upload succeeded but no document name returned");
  }

  console.log(`[UPLOAD] SUCCESS: ${documentName}`);
  return documentName || storeId;
}

/**
 * Deletes a document from the Gemini FileSearch Store.
 */
export async function deleteFromGeminiStore(
  geminiDocId: string
): Promise<void> {
  const client = getClient();

  try {
    if (geminiDocId.startsWith("fileSearchStores/") && geminiDocId.includes("/documents/")) {
      // Store document — delete from store (force deletes chunks too)
      await client.fileSearchStores.documents.delete({
        name: geminiDocId,
        config: { force: true },
      });
    } else {
      // Legacy file reference — delete from Files API
      await client.files.delete({ name: geminiDocId });
    }
  } catch (err: unknown) {
    // Treat 404 as success — document is already gone
    const status = (err as { status?: number }).status;
    if (status === 404) {
      console.log(`[DELETE] Already deleted: ${geminiDocId}`);
      return;
    }
    console.error(`[DELETE] Failed to delete ${geminiDocId}:`, err);
    throw err;
  }
}

export interface ChatCitation {
  index: number;
  sourceId: string;
  sourceName: string;
  chunkText: string;
  type?: "source" | "web";
  url?: string;
  /** Sub-agent that produced this citation, when not from FileSearch. */
  via?: "web" | "maps" | "url";
}

export interface ToolCallEvent {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  output?: string;
  citations?: ChatCitation[];
  error?: string;
  durationMs?: number;
}

export interface ActionApprovalEvent {
  actionId: string;
  provider: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  expiresAt: number;
}

export interface ScopeExpansionEvent {
  provider: string;
  tool: string;
  missingScopes: string[];
}

export type ChatChunk =
  | { type: "token"; text: string }
  | { type: "citations"; citations: ChatCitation[] }
  | { type: "tool_call"; toolCall: ToolCallEvent }
  | { type: "action_approval_required"; action: ActionApprovalEvent }
  | { type: "scope_expansion_required"; scope: ScopeExpansionEvent }
  | { type: "done"; totalTokens: number };

/**
 * Streams a chat response from Gemini using FileSearch Store for grounding.
 * Filters by notebookId metadata to ensure notebook-level data isolation.
 */
function buildSystemPrompt(
  customSystemPrompt?: string,
  channel: string = "web",
  enabledTools: Record<string, boolean> = {}
): string {
  const hasWebTools = enabledTools.googleSearch || enabledTools.urlContext || enabledTools.googleMaps;
  let prompt = hasWebTools
    ? SYSTEM_PROMPT.replace("grounded exclusively in", "grounded primarily in")
    : SYSTEM_PROMPT;
  if (hasWebTools) {
    prompt += `\n\n${WEB_TOOLS_PROMPT_ADDON}`;
  }
  if (customSystemPrompt) {
    prompt += `\n\n${customSystemPrompt}`;
  }
  const channelOverride = CHANNEL_PROMPT_OVERRIDES[channel];
  if (channelOverride) {
    prompt += `\n\n${channelOverride}`;
  }
  return prompt;
}

/**
 * Extracts citations from Gemini's groundingMetadata in the last response chunk.
 */
function extractCitations(lastChunk: Record<string, unknown> | null): {
  citations: ChatCitation[];
  totalTokens: number;
} {
  const usageMetadata = lastChunk?.usageMetadata as Record<string, unknown> | undefined;
  const totalTokens = (usageMetadata?.totalTokenCount as number) ?? 0;

  const citations: ChatCitation[] = [];

  try {
    const candidates = lastChunk?.candidates as Array<Record<string, unknown>> | undefined;
    const candidate = candidates?.[0];

    const content = candidate?.content as Record<string, unknown> | undefined;
    const parts = content?.parts as Array<Record<string, unknown>> | undefined;
    if (parts) {
      console.log(`[CHAT] Response parts count: ${parts.length}`);
      for (let i = 0; i < parts.length; i++) {
        const partKeys = Object.keys(parts[i]);
        console.log(`[CHAT] Part ${i} keys: ${partKeys.join(", ")}`);
      }
    }

    const grounding = candidate?.groundingMetadata as Record<string, unknown> | undefined;
    console.log(`[CHAT] groundingMetadata present: ${!!grounding}`);

    const groundingChunks = grounding?.groundingChunks as Array<Record<string, unknown>> | undefined;
    const groundingSupports = grounding?.groundingSupports as Array<Record<string, unknown>> | undefined;

    console.log(`[CHAT] groundingChunks: ${groundingChunks?.length ?? 0}`);
    console.log(`[CHAT] groundingSupports: ${groundingSupports?.length ?? 0}`);

    if (groundingChunks && groundingSupports) {
      groundingSupports.forEach((support: Record<string, unknown>) => {
        const chunkIndices = (support.groundingChunkIndices as number[]) ?? [];
        const segment = support.segment as Record<string, unknown> | undefined;
        const chunkText = (segment?.text as string) ?? "";

        for (const chunkIdx of chunkIndices) {
          const chunk = groundingChunks[chunkIdx];

          // FileSearch citations (uploaded documents)
          const retrieved = chunk?.retrievedContext as Record<string, unknown> | undefined;
          if (retrieved) {
            console.log(`[CHAT] Citation found: uri=${retrieved.uri}, title=${retrieved.title}`);
            citations.push({
              index: citations.length + 1,
              sourceId: (retrieved.uri as string) ?? "",
              sourceName: (retrieved.title as string) ?? `Source ${chunkIdx + 1}`,
              chunkText,
              type: "source",
            });
            continue;
          }

          // Web citations (Google Search / URL Context / Maps)
          const web = chunk?.web as { uri?: string; title?: string } | undefined;
          if (web?.uri) {
            console.log(`[CHAT] Web citation found: uri=${web.uri}, title=${web.title}`);
            citations.push({
              index: citations.length + 1,
              sourceId: web.uri,
              sourceName: web.title ?? "Web source",
              chunkText,
              type: "web",
              url: web.uri,
            });
          }
        }
      });
    }
  } catch (err) {
    console.error(`[CHAT] Error extracting citations:`, err);
  }

  console.log(`[CHAT] Total citations: ${citations.length}`);
  return { citations, totalTokens };
}

/** Valid tool override values from slash commands */
const TOOL_OVERRIDES: Record<string, Record<string, unknown>> = {
  googleSearch: { googleSearch: {} },
  urlContext: { urlContext: {} },
  googleMaps: { googleMaps: {} },
};

/** Attachment metadata passed from frontend/Telegram for multimodal messages */
export interface ChatAttachment {
  storageRef: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
}

/**
 * Downloads attachments from Cloud Storage and converts to Gemini inline parts.
 */
async function prepareMultimodalParts(
  attachments: ChatAttachment[]
): Promise<Array<{ inlineData: { mimeType: string; data: string } }>> {
  const bucket = admin.storage().bucket(getStorageBucketName());
  const parts: Array<{ inlineData: { mimeType: string; data: string } }> = [];

  for (const att of attachments) {
    console.log(`[CHAT] Downloading attachment: ${att.fileName} (${att.mimeType}, ${att.sizeBytes} bytes)`);
    const [buffer] = await bucket.file(att.storageRef).download();
    parts.push({
      inlineData: {
        mimeType: att.mimeType,
        data: buffer.toString("base64"),
      },
    });
  }

  console.log(`[CHAT] Prepared ${parts.length} multimodal parts`);
  return parts;
}

export async function* queryWithFileSearch(
  query: string,
  history: Array<{ role: string; content: string }>,
  notebookId: string,
  modelId: string,
  customSystemPrompt?: string,
  channel: "web" | "telegram" = "web",
  enabledTools: Record<string, boolean> = {},
  toolOverride?: string,
  attachments?: ChatAttachment[]
): AsyncGenerator<ChatChunk> {
  const client = getClient();
  const storeId = getGeminiStoreId();
  const apiModel = GEMINI_MODELS[modelId] || "gemini-2.5-flash";
  // IMPORTANT: Gemini metadataFilter does NOT support camelCase keys — use snake_case
  const metadataFilter = `notebook_id = "${notebookId}"`;

  console.log(`[CHAT] ---- New query ----`);
  console.log(`[CHAT] notebookId=${notebookId}, model=${apiModel}`);
  console.log(`[CHAT] storeId=${storeId}`);
  console.log(`[CHAT] metadataFilter=${metadataFilter}`);
  console.log(`[CHAT] query="${query}"`);
  console.log(`[CHAT] history length=${history.length}`);
  console.log(`[CHAT] toolOverride=${toolOverride ?? "none"}`);
  console.log(`[CHAT] attachments=${attachments?.length ?? 0}`);

  // Build conversation history (text-only — previous attachments already processed)
  const contents: Content[] = [];
  for (const msg of history) {
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    });
  }

  // Build current user message with optional multimodal parts
  const userParts: Array<Record<string, unknown>> = [];
  if (attachments?.length) {
    const mediaParts = await prepareMultimodalParts(attachments);
    userParts.push(...mediaParts);
  }
  // Pre-fetch any URLs the user pasted (Jina Reader). Same behavior as the
  // orchestrator path so this works on Gemini 2.5 too.
  const userUrls = extractUrlsFromText(query);
  if (userUrls.length > 0) {
    const prefetchId = `prefetch_${Date.now()}`;
    const prefetchStart = Date.now();
    console.log(`[CHAT] prefetching ${userUrls.length} URL(s) via Jina`);
    yield {
      type: "tool_call",
      toolCall: {
        id: prefetchId,
        name: "url_prefetch",
        args: { urls: userUrls },
        status: "running",
      },
    };
    const fetched = await prefetchUrls(userUrls);
    const okCount = fetched.filter((r) => r.ok).length;
    console.log(`[CHAT] prefetch results: ${okCount}/${fetched.length} ok`);
    const block = renderPrefetchBlock(fetched);
    if (block) userParts.push({ text: block });
    yield {
      type: "tool_call",
      toolCall: {
        id: prefetchId,
        name: "url_prefetch",
        args: { urls: userUrls },
        status: okCount > 0 ? "done" : "error",
        output: fetched
          .map(
            (r) =>
              `${r.ok ? "✓" : "✗"} ${r.url}${r.title ? ` — ${r.title}` : ""}${
                r.error ? ` (${r.error})` : ""
              }${r.markdown ? "\n\n" + r.markdown.slice(0, 1500) + (r.markdown.length > 1500 ? "\n[…]" : "") : ""}`
          )
          .join("\n\n---\n\n"),
        durationMs: Date.now() - prefetchStart,
        error: okCount === 0 ? "all URLs failed" : undefined,
      },
    };
  }
  if (query) {
    userParts.push({ text: query });
  }
  contents.push({ role: "user", parts: userParts });

  // Determine which tool to use:
  // - toolOverride (from /web, /maps, /url commands) → use that specific web tool
  // - default → FileSearch (uploaded sources)
  const overrideTool = toolOverride ? TOOL_OVERRIDES[toolOverride] : null;
  const tools: Array<Record<string, unknown>> = overrideTool
    ? [overrideTool]
    : [
        {
          fileSearch: {
            fileSearchStoreNames: [storeId],
            metadataFilter,
          },
        },
      ];

  const systemInstruction = buildSystemPrompt(customSystemPrompt, channel, enabledTools);
  console.log(`[CHAT] tools config: ${JSON.stringify(tools)}`);

  const response = await client.models.generateContentStream({
    model: apiModel,
    contents,
    config: { systemInstruction, tools },
  });

  let lastChunk: Record<string, unknown> | null = null;
  let chunkCount = 0;

  for await (const chunk of response) {
    const text = chunk.text ?? "";
    if (text) {
      chunkCount++;
      yield { type: "token", text };
    }
    lastChunk = chunk as unknown as Record<string, unknown>;
  }

  const { citations, totalTokens } = extractCitations(lastChunk);
  console.log(`[CHAT] Stream complete. Chunks: ${chunkCount}, Tokens: ${totalTokens}`);
  if (citations.length > 0) yield { type: "citations", citations };
  yield { type: "done", totalTokens };
}

/** True for any Gemini 3 family model id (preview or stable). */
export function isGemini3(apiModelId: string): boolean {
  return /^gemini-3/i.test(apiModelId);
}

/**
 * Picks orchestrator vs legacy single-tool path. Same SSE event shape either way.
 *
 * Orchestrator runs only when:
 *  - MULTI_TOOL_ENABLED=true
 *  - the resolved API model is Gemini 3
 *  - no slash-command toolOverride is set (slash commands stay as the
 *    explicit single-tool fast path)
 */
export function routeChat(
  query: string,
  history: Array<{ role: string; content: string }>,
  uid: string,
  notebookId: string,
  sessionId: string | undefined,
  modelId: string,
  customSystemPrompt?: string,
  channel: "web" | "telegram" = "web",
  enabledTools: Record<string, boolean> = {},
  toolOverride?: string,
  attachments?: ChatAttachment[]
): AsyncGenerator<ChatChunk> {
  const apiModel = GEMINI_MODELS[modelId] || "gemini-2.5-flash";
  const useOrchestrator =
    MULTI_TOOL_ENABLED && !toolOverride && isGemini3(apiModel);

  console.log(
    `[ROUTE] model=${apiModel} flag=${MULTI_TOOL_ENABLED} override=${toolOverride ?? "none"} → ${
      useOrchestrator ? "orchestrator" : "legacy single-tool"
    }`
  );

  if (useOrchestrator) {
    return orchestrate(
      query,
      history,
      uid,
      notebookId,
      sessionId,
      modelId,
      customSystemPrompt,
      channel,
      attachments
    );
  }
  return queryWithFileSearch(
    query,
    history,
    notebookId,
    modelId,
    customSystemPrompt,
    channel,
    enabledTools,
    toolOverride,
    attachments
  );
}
