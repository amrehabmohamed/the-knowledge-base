import { GoogleGenAI, type Content } from "@google/genai";
import * as admin from "firebase-admin";
import {
  getGeminiApiKey,
  getGeminiStoreId,
  GEMINI_MODELS,
  SYSTEM_PROMPT,
  CHANNEL_PROMPT_OVERRIDES,
} from "../config";

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
  const bucket = admin.storage().bucket();
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
}

export type ChatChunk =
  | { type: "token"; text: string }
  | { type: "citations"; citations: ChatCitation[] }
  | { type: "done"; totalTokens: number };

/**
 * Streams a chat response from Gemini using FileSearch Store for grounding.
 * Filters by notebookId metadata to ensure notebook-level data isolation.
 */
function buildSystemPrompt(
  customSystemPrompt?: string,
  channel: string = "web"
): string {
  let prompt = SYSTEM_PROMPT;
  if (customSystemPrompt) {
    prompt += `\n\n${customSystemPrompt}`;
  }
  const channelOverride = CHANNEL_PROMPT_OVERRIDES[channel];
  if (channelOverride) {
    prompt += `\n\n${channelOverride}`;
  }
  return prompt;
}

export async function* queryWithFileSearch(
  query: string,
  history: Array<{ role: string; content: string }>,
  notebookId: string,
  modelId: string,
  customSystemPrompt?: string,
  channel: "web" | "telegram" = "web"
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

  // Build conversation history
  const contents: Content[] = [];
  for (const msg of history) {
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    });
  }
  contents.push({
    role: "user",
    parts: [{ text: query }],
  });

  // Filter by notebook_id for tenant isolation
  const toolConfig = {
    fileSearch: {
      fileSearchStoreNames: [storeId],
      metadataFilter,
    },
  };
  console.log(`[CHAT] tools config: ${JSON.stringify(toolConfig)}`);

  const response = await client.models.generateContentStream({
    model: apiModel,
    contents,
    config: {
      systemInstruction: buildSystemPrompt(customSystemPrompt, channel),
      tools: [toolConfig],
    },
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

  // Extract real token usage from Gemini's usageMetadata
  const usageMetadata = lastChunk?.usageMetadata as
    | Record<string, unknown>
    | undefined;
  const totalTokens =
    (usageMetadata?.totalTokenCount as number) ?? 0;
  const promptTokens =
    (usageMetadata?.promptTokenCount as number) ?? 0;
  const candidateTokens =
    (usageMetadata?.candidatesTokenCount as number) ?? 0;

  console.log(`[CHAT] Stream complete. Chunks: ${chunkCount}, Tokens: prompt=${promptTokens} candidate=${candidateTokens} total=${totalTokens}`);

  // Log raw last chunk for debugging
  try {
    const candidates = (lastChunk as Record<string, unknown>)?.candidates as
      | Array<Record<string, unknown>>
      | undefined;
    const candidate = candidates?.[0];

    // Log all parts to see executableCode and other non-text parts
    const content = candidate?.content as Record<string, unknown> | undefined;
    const parts = content?.parts as Array<Record<string, unknown>> | undefined;
    if (parts) {
      console.log(`[CHAT] Response parts count: ${parts.length}`);
      for (let i = 0; i < parts.length; i++) {
        const partKeys = Object.keys(parts[i]);
        console.log(`[CHAT] Part ${i} keys: ${partKeys.join(", ")}`);
        if (parts[i].executableCode) {
          console.log(`[CHAT] Part ${i} executableCode: ${JSON.stringify(parts[i].executableCode)}`);
        }
      }
    }

    const grounding = candidate?.groundingMetadata as
      | Record<string, unknown>
      | undefined;

    console.log(`[CHAT] groundingMetadata present: ${!!grounding}`);
    if (grounding) {
      console.log(`[CHAT] groundingMetadata keys: ${Object.keys(grounding).join(", ")}`);
    }

    const groundingChunks = grounding?.groundingChunks as
      | Array<Record<string, unknown>>
      | undefined;
    const groundingSupports = grounding?.groundingSupports as
      | Array<Record<string, unknown>>
      | undefined;

    console.log(`[CHAT] groundingChunks: ${groundingChunks?.length ?? 0}`);
    console.log(`[CHAT] groundingSupports: ${groundingSupports?.length ?? 0}`);

    // Extract citations from grounding metadata
    const citations: ChatCitation[] = [];

    if (groundingChunks && groundingSupports) {
      groundingSupports.forEach((support: Record<string, unknown>) => {
        const chunkIndices =
          (support.groundingChunkIndices as number[]) ?? [];
        const segment = support.segment as
          | Record<string, unknown>
          | undefined;
        const chunkText = (segment?.text as string) ?? "";

        for (const chunkIdx of chunkIndices) {
          const chunk = groundingChunks[chunkIdx];
          const retrieved = chunk?.retrievedContext as
            | Record<string, unknown>
            | undefined;
          if (retrieved) {
            console.log(`[CHAT] Citation found: uri=${retrieved.uri}, title=${retrieved.title}`);
            citations.push({
              index: citations.length + 1,
              sourceId: (retrieved.uri as string) ?? "",
              sourceName:
                (retrieved.title as string) ?? `Source ${chunkIdx + 1}`,
              chunkText,
            });
          }
        }
      });
    }

    console.log(`[CHAT] Total citations: ${citations.length}`);

    if (citations.length > 0) {
      yield { type: "citations", citations };
    }
  } catch (err) {
    console.error(`[CHAT] Error extracting citations:`, err);
  }

  yield { type: "done", totalTokens };
}
