import { GoogleGenAI, type Content } from "@google/genai";
import {
  getGeminiApiKey,
  getGeminiStoreId,
  GEMINI_MODELS,
  GEMINI_FALLBACK_MODEL,
  CHANNEL_PROMPT_OVERRIDES,
  SYSTEM_PROMPT,
  WEB_TOOLS_PROMPT_ADDON_V2,
  getStorageBucketName,
} from "../config";
import type { ChatChunk, ChatCitation, ChatAttachment } from "./gemini";
import {
  ALL_FUNCTION_DECLARATIONS,
  dispatch,
  mergeAndDedupeCitations,
} from "./subagents";
import {
  extractUrlsFromText,
  prefetchUrls,
  renderPrefetchBlock,
} from "./urlPrefetch";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  return client;
}

const MAX_TOOL_TURNS = 4;

function buildOrchestratorSystemPrompt(
  customSystemPrompt: string | undefined,
  channel: string
): string {
  let prompt = SYSTEM_PROMPT.replace(
    "grounded exclusively in",
    "grounded primarily in"
  );
  prompt += `\n\n${WEB_TOOLS_PROMPT_ADDON_V2}`;
  if (customSystemPrompt) prompt += `\n\n${customSystemPrompt}`;
  const channelOverride = CHANNEL_PROMPT_OVERRIDES[channel];
  if (channelOverride) prompt += `\n\n${channelOverride}`;
  return prompt;
}

interface FunctionCall {
  /** Local sub-agent name (e.g. "web_search") used for dispatch. */
  name: string;
  /** The full name as sent by Gemini (may include namespacing like "default_api:web_search").
   *  Echoed back verbatim in the matching functionResponse. */
  fullName: string;
  args: Record<string, unknown>;
  id?: string;
}

function extractFileSearchCitations(
  candidate: Record<string, unknown> | undefined
): ChatCitation[] {
  const citations: ChatCitation[] = [];
  const grounding = candidate?.groundingMetadata as
    | Record<string, unknown>
    | undefined;
  const groundingChunks = grounding?.groundingChunks as
    | Array<Record<string, unknown>>
    | undefined;
  const groundingSupports = grounding?.groundingSupports as
    | Array<Record<string, unknown>>
    | undefined;
  if (!groundingChunks || !groundingSupports) return citations;

  groundingSupports.forEach((support) => {
    const idxs = (support.groundingChunkIndices as number[]) ?? [];
    const segment = support.segment as Record<string, unknown> | undefined;
    const chunkText = (segment?.text as string) ?? "";
    for (const i of idxs) {
      const ch = groundingChunks[i];
      const retrieved = ch?.retrievedContext as
        | Record<string, unknown>
        | undefined;
      if (retrieved) {
        citations.push({
          index: citations.length + 1,
          sourceId: (retrieved.uri as string) ?? "",
          sourceName: (retrieved.title as string) ?? "Source",
          chunkText,
          type: "source",
        });
        continue;
      }
      const web = ch?.web as { uri?: string; title?: string } | undefined;
      if (web?.uri) {
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
  return citations;
}

async function prepareMultimodalParts(
  attachments: ChatAttachment[]
): Promise<Array<{ inlineData: { mimeType: string; data: string } }>> {
  const admin = await import("firebase-admin");
  const bucket = admin.storage().bucket(getStorageBucketName());
  const parts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  for (const att of attachments) {
    const [buffer] = await bucket.file(att.storageRef).download();
    parts.push({
      inlineData: { mimeType: att.mimeType, data: buffer.toString("base64") },
    });
  }
  return parts;
}

/**
 * Orchestrator: parent Gemini 3 model with FileSearch + custom function
 * declarations. Streams tokens to the caller, dispatches function calls to
 * sub-agents, runs QC, threads results back into the conversation, repeats.
 *
 * Falls back to GEMINI_FALLBACK_MODEL on hard errors from the user-selected
 * model. SSE event shape matches queryWithFileSearch (token | citations | done).
 */
export async function* orchestrate(
  query: string,
  history: Array<{ role: string; content: string }>,
  notebookId: string,
  modelId: string,
  customSystemPrompt?: string,
  channel: "web" | "telegram" = "web",
  attachments?: ChatAttachment[]
): AsyncGenerator<ChatChunk> {
  const c = getClient();
  const storeId = getGeminiStoreId();
  const userPickedModel = GEMINI_MODELS[modelId] || GEMINI_FALLBACK_MODEL;
  const metadataFilter = `notebook_id = "${notebookId}"`;

  console.log(`[ORCH] ---- New orchestrated query ----`);
  console.log(`[ORCH] notebookId=${notebookId}, model=${userPickedModel}`);
  console.log(`[ORCH] query="${query}"`);

  const contents: Content[] = [];
  for (const m of history) {
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }
  const userParts: Array<Record<string, unknown>> = [];
  if (attachments?.length) {
    const mediaParts = await prepareMultimodalParts(attachments);
    userParts.push(...mediaParts);
  }
  // Pre-fetch any URLs the user pasted in this turn via Jina Reader. Cleaner
  // markdown than urlContext, and the parent model gets the content from
  // turn 0 instead of having to call url_fetch.
  const userUrls = extractUrlsFromText(query);
  if (userUrls.length > 0) {
    const prefetchId = `prefetch_${Date.now()}`;
    const prefetchStart = Date.now();
    console.log(`[ORCH] prefetching ${userUrls.length} URL(s) via Jina`);
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
    console.log(
      `[ORCH] prefetch results: ${okCount}/${fetched.length} ok` +
        fetched
          .filter((r) => !r.ok)
          .map((r) => ` | fail ${r.url}: ${r.error}`)
          .join("")
    );
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
  if (query) userParts.push({ text: query });
  contents.push({ role: "user", parts: userParts });

  const systemInstruction = buildOrchestratorSystemPrompt(
    customSystemPrompt,
    channel
  );

  const tools = [
    {
      fileSearch: {
        fileSearchStoreNames: [storeId],
        metadataFilter,
      },
    },
    { functionDeclarations: ALL_FUNCTION_DECLARATIONS },
  ];
  const toolConfig = { includeServerSideToolInvocations: true };

  let modelToUse = userPickedModel;
  let usedFallback = false;
  let totalTokens = 0;
  const fileSearchCitationGroups: ChatCitation[][] = [];
  const subAgentCitationGroups: ChatCitation[][] = [];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const calls: FunctionCall[] = [];
    const modelParts: Array<Record<string, unknown>> = [];
    let lastCandidate: Record<string, unknown> | undefined;

    let stream: AsyncIterable<unknown>;
    try {
      stream = await c.models.generateContentStream({
        model: modelToUse,
        contents,
        config: { systemInstruction, tools, toolConfig },
      });
    } catch (err) {
      if (!usedFallback && modelToUse !== GEMINI_FALLBACK_MODEL) {
        console.warn(
          `[ORCH] model ${modelToUse} failed, falling back to ${GEMINI_FALLBACK_MODEL}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        modelToUse = GEMINI_FALLBACK_MODEL;
        usedFallback = true;
        turn--; // retry this turn with fallback
        continue;
      }
      throw err;
    }

    // Each chunk delivers one or more new parts (text/functionCall/toolCall/toolResponse/...).
    // A part is a "oneof" — only ONE data field allowed, plus annotations like
    // thoughtSignature. Some chunks deliver a signature-only annotation that
    // should attach to the most recent data-bearing part. So: push each part as
    // it arrives, then after the stream walk the list and merge signature-only
    // parts into their adjacent data part.
    const DATA_FIELDS = [
      "text",
      "functionCall",
      "functionResponse",
      "toolCall",
      "toolResponse",
      "executableCode",
      "codeExecutionResult",
      "fileData",
      "inlineData",
    ];
    const hasDataField = (p: Record<string, unknown>): boolean =>
      DATA_FIELDS.some((f) => p[f] !== undefined);

    const rawParts: Array<Record<string, unknown>> = [];

    for await (const chunk of stream as AsyncIterable<Record<string, unknown>>) {
      const text = (chunk as { text?: string }).text ?? "";
      if (text) {
        yield { type: "token", text };
      }
      const candidates = chunk.candidates as
        | Array<Record<string, unknown>>
        | undefined;
      const cand = candidates?.[0];
      if (cand) lastCandidate = cand;
      const content = cand?.content as Record<string, unknown> | undefined;
      const parts = content?.parts as Array<Record<string, unknown>> | undefined;
      if (parts) {
        for (const p of parts) rawParts.push(p);
      }
      const usage = (chunk as { usageMetadata?: { totalTokenCount?: number } })
        .usageMetadata;
      if (usage?.totalTokenCount) totalTokens = usage.totalTokenCount;
    }

    // Post-process: fold any part that has NO data field (e.g. only thoughtSignature)
    // into the most recent part with a data field.
    for (const p of rawParts) {
      if (!hasDataField(p) && modelParts.length > 0) {
        const last = modelParts[modelParts.length - 1];
        // Merge non-data annotations (signature, thought) onto the last data part.
        for (const k of Object.keys(p)) {
          if (last[k] === undefined) last[k] = p[k];
        }
      } else {
        modelParts.push({ ...p });
      }
    }

    // Extract function calls.
    for (const p of modelParts) {
      if (p.functionCall) {
        const fc = p.functionCall as {
          name?: string;
          args?: Record<string, unknown>;
          id?: string;
        };
        if (fc.name) {
          const localName = fc.name.includes(":")
            ? fc.name.split(":").pop()!
            : fc.name;
          calls.push({
            name: localName,
            fullName: fc.name,
            args: fc.args ?? {},
            id: fc.id,
          });
        }
      }
    }
    console.log(
      `[ORCH] turn=${turn} captured ${modelParts.length} model part(s). keys per part: ${JSON.stringify(
        modelParts.map((p) => Object.keys(p))
      )}`
    );

    // Capture FileSearch (and any direct web) citations from this turn.
    const turnCitations = extractFileSearchCitations(lastCandidate);
    if (turnCitations.length) fileSearchCitationGroups.push(turnCitations);

    if (calls.length === 0) {
      // No function calls — this turn was the final answer.
      break;
    }

    console.log(
      `[ORCH] turn=${turn} model emitted ${calls.length} function call(s): ${calls
        .map((c) => c.name)
        .join(", ")}`
    );

    // Append the model's tool-call message to history.
    contents.push({ role: "model", parts: modelParts as Content["parts"] });

    // Emit a "running" tool_call event for each, dispatch in parallel, emit
    // "done"/"error" after.
    const eventIds = calls.map(
      (c) =>
        c.id ??
        `${c.name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    );
    const startTimes = calls.map(() => Date.now());
    for (let i = 0; i < calls.length; i++) {
      yield {
        type: "tool_call",
        toolCall: {
          id: eventIds[i],
          name: calls[i].name,
          args: calls[i].args,
          status: "running",
        },
      };
    }
    const results = await Promise.all(
      calls.map((call) => dispatch(call.name, call.args))
    );

    // Build functionResponse parts for the next turn.
    const responseParts: Array<Record<string, unknown>> = [];
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const res = results[i];
      if (res.ok) {
        subAgentCitationGroups.push(res.citations);
        totalTokens += res.rawTokens;
      }
      yield {
        type: "tool_call",
        toolCall: {
          id: eventIds[i],
          name: call.name,
          args: call.args,
          status: res.ok ? "done" : "error",
          output: res.summary,
          citations: res.citations,
          error: res.ok ? undefined : res.reason ?? "no usable result",
          durationMs: Date.now() - startTimes[i],
        },
      };
      responseParts.push({
        functionResponse: {
          // Echo the exact name Gemini sent (may include "default_api:" prefix).
          name: call.fullName,
          id: call.id,
          response: res.ok
            ? { summary: res.summary, citations: res.citations.length }
            : { error: res.reason ?? "no usable result", summary: "" },
        },
      });
    }
    contents.push({ role: "user", parts: responseParts as Content["parts"] });

    // Loop continues — parent gets to see function responses and produce final answer
    // (or call more tools).
    if (turn === MAX_TOOL_TURNS - 1) {
      console.warn(`[ORCH] hit MAX_TOOL_TURNS=${MAX_TOOL_TURNS}, stopping`);
    }
  }

  const allCitations = mergeAndDedupeCitations([
    ...fileSearchCitationGroups,
    ...subAgentCitationGroups,
  ]);
  if (allCitations.length > 0) {
    yield { type: "citations", citations: allCitations };
  }
  yield { type: "done", totalTokens };
}
