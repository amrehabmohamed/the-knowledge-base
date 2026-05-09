import { GoogleGenAI, Type, type Content, type FunctionDeclaration } from "@google/genai";
import { createHash } from "crypto";
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
import type {
  ChatChunk,
  ChatCitation,
  ChatAttachment,
  ClarificationQuestion,
  PriorToolCall,
} from "./gemini";
import {
  ALL_FUNCTION_DECLARATIONS,
  dispatch,
  mergeAndDedupeCitations,
} from "./subagents";
import { INVALIDATIONS, isWrite, type Invalidation } from "./connectors";

/**
 * `ask_user` is an orchestrator-level control function (not a sub-agent).
 * Emitting it pauses the multi-tool loop and surfaces a structured form to
 * the user; the agent picks up where it left off on the next turn after the
 * user replies. Designed to batch every clarifying question into ONE prompt
 * so multi-step requests don't ping-pong field-by-field.
 */
const ASK_USER_DECL: FunctionDeclaration = {
  name: "ask_user",
  description:
    "Ask the user one or more clarifying questions BEFORE taking any write " +
    "action when required data is missing, ambiguous, or would otherwise be " +
    "fabricated. Batch ALL questions for the current request into a SINGLE " +
    "call — do not split asks across turns. Use ONLY for genuinely user-side " +
    "data (which date? which person if multiple match? which custom field?). " +
    "Do NOT use for things you can look up with another tool first " +
    "(crm_list_users, crm_list_stages, crm_list_custom_fields all exist for " +
    "this reason). After the user replies, you'll see their answers in their " +
    "next message and should proceed with the full multi-action plan.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      reason: {
        type: Type.STRING,
        description:
          "One-line context shown above the form, e.g. 'I need a couple of " +
          "details before I can move and snooze this lead.'",
      },
      questions: {
        type: Type.ARRAY,
        description: "Every question batched into one ask.",
        items: {
          type: Type.OBJECT,
          properties: {
            key: {
              type: Type.STRING,
              description: "Stable id, e.g. 'snoozeDate' or 'assignee'.",
            },
            prompt: {
              type: Type.STRING,
              description: "The question text shown to the user.",
            },
            type: {
              type: Type.STRING,
              description: "'text' | 'date' | 'select'.",
            },
            options: {
              type: Type.ARRAY,
              description:
                "Required for type='select'. Each option is { id, label }.",
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  label: { type: Type.STRING },
                },
              },
            },
            required: { type: Type.BOOLEAN },
          },
          required: ["key", "prompt", "type"],
        },
      },
    },
    required: ["reason", "questions"],
  },
};
import {
  extractUrlsFromText,
  prefetchUrls,
  renderPrefetchBlock,
} from "./urlPrefetch";
import { bootConnectors, getEnabledDeclarations } from "./connectors";

// Boot connectors once at module load (idempotent; no-op when CONNECTORS_ENABLED!=true).
bootConnectors().catch((err) =>
  console.error("[ORCH] bootConnectors failed:", err)
);

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  return client;
}

// Generous cap so multi-step CRM flows (date parsing → list_stages → list_leads
// → transition) never silently die mid-chain. Hitting this in practice means a
// real loop, not a legitimately long task.
const MAX_TOOL_TURNS = 100;

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
/**
 * Replay persisted history into Gemini Content[] form, with two key behaviors:
 *
 *  1. Tool-aware: when an assistant turn carries `toolCalls`, we emit a model
 *     turn with `functionCall` parts plus a user turn with matching
 *     `functionResponse` parts — so the model can SEE its own prior tool I/O
 *     and stop re-fetching data it already has.
 *
 *  2. Write-aware stripping: a forward pass collects every prior write call
 *     and its `Invalidation` entry. The replay pass then substitutes a stub
 *     `{status:"stale", reason:"invalidated by later <writeTool>"}` response
 *     for any read call whose result has been invalidated by a later write,
 *     keeping the call/response slot intact (Gemini requires matched pairs)
 *     while signaling the model to re-fetch.
 *
 *  Built-in sub-agents (web_search, maps_search, url_fetch) are not in
 *  INVALIDATIONS — they're never stripped.
 */
function reconstructHistory(
  history: Array<{ role: string; content: string; toolCalls?: PriorToolCall[] }>
): Content[] {
  // ─── Forward pass: collect writes with their invalidation rules ─────────
  type WriteEvent = {
    turnIdx: number;
    callIdxInTurn: number;
    name: string;
    args: Record<string, unknown>;
    inv: Invalidation;
  };
  // ─── HITL replay strategy ──────────────────────────────────────────────
  // Each awaitingApproval entry represents a HITL *proposal*. Possible fates:
  //   (a) user confirmed → a later non-awaiting toolCall (the synthetic
  //       `hitl_executed` message) carries the real result. Drop the proposal;
  //       the synthetic supersedes it.
  //   (b) user cancelled / expired / hasn't decided yet → no later matching
  //       execution exists. Keep the proposal and replay its functionResponse
  //       as `{status: "awaiting_user_approval"}` so the agent KNOWS it already
  //       asked and doesn't re-emit on `[continue]` while the user is still
  //       considering a sibling card.
  // Match by name + canonical(args) — proposals and their synthetic carry
  // identical args (round-tripped through pendingAction doc + SSE).
  const canonArgs = (args: Record<string, unknown>): string => {
    try {
      const keys = Object.keys(args).sort();
      return JSON.stringify(args, keys);
    } catch {
      return JSON.stringify(args);
    }
  };
  const isSupersededByLaterExecution = (
    awaitTurnIdx: number,
    awaitCallIdx: number,
    awaiting: PriorToolCall
  ): boolean => {
    const target = canonArgs(awaiting.args);
    for (let t = awaitTurnIdx; t < history.length; t++) {
      const m = history[t];
      if (m.role !== "assistant" || !m.toolCalls?.length) continue;
      for (let i = 0; i < m.toolCalls.length; i++) {
        if (t === awaitTurnIdx && i <= awaitCallIdx) continue;
        const tc = m.toolCalls[i];
        if (tc.awaitingApproval) continue;
        if (tc.name !== awaiting.name) continue;
        if (canonArgs(tc.args) === target) return true;
      }
    }
    return false;
  };

  // For each turn, build a filtered toolCalls list AND a parallel array of
  // per-call replay annotations: { drop, awaitingStub }.
  type ReplaySlot = {
    tc: PriorToolCall;
    /** True when this is an awaitingApproval entry we should keep but stub. */
    awaitingStub: boolean;
  };
  const replaySlotsByTurn: ReplaySlot[][] = history.map((m, t) => {
    if (m.role !== "assistant") return [];
    const slots: ReplaySlot[] = [];
    const tcs = m.toolCalls ?? [];
    for (let i = 0; i < tcs.length; i++) {
      const tc = tcs[i];
      if (tc.awaitingApproval) {
        if (isSupersededByLaterExecution(t, i, tc)) continue; // drop
        slots.push({ tc, awaitingStub: true });
      } else {
        slots.push({ tc, awaitingStub: false });
      }
    }
    return slots;
  });
  // Forward write-collection — index in replaySlotsByTurn space so staleReason
  // lookups in the replay pass align. Skip awaiting stubs (no upstream write
  // happened) and reads.
  const writes: WriteEvent[] = [];
  for (let t = 0; t < replaySlotsByTurn.length; t++) {
    const slots = replaySlotsByTurn[t];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot.awaitingStub) continue;
      const tc = slot.tc;
      if (!isWrite(tc.name)) continue;
      const inv = INVALIDATIONS[tc.name];
      if (!inv) continue;
      writes.push({ turnIdx: t, callIdxInTurn: i, name: tc.name, args: tc.args, inv });
    }
  }

  /**
   * Returns the name of the *first* later write that invalidates this read,
   * or null if the read is still fresh.
   */
  function staleReason(
    readTurnIdx: number,
    readCallIdxInTurn: number,
    readName: string,
    readArgs: Record<string, unknown>
  ): string | null {
    for (const w of writes) {
      // Strictly later: write must come after the read in conversation order.
      if (
        w.turnIdx < readTurnIdx ||
        (w.turnIdx === readTurnIdx && w.callIdxInTurn <= readCallIdxInTurn)
      ) {
        continue;
      }
      if (w.inv.kind === "global") {
        if (w.inv.reads.includes(readName)) return w.name;
        continue;
      }
      // per_resource
      if (!w.inv.reads.includes(readName)) continue;
      const writeId = w.inv.writeResourceId(w.args);
      if (writeId === null) continue; // write has no resource id → can't target
      const readId = w.inv.readResourceId(readName, readArgs);
      // null on the read side means "this read pertains to ALL resources of
      // this type" (e.g. lists) → invalidate on any per-resource write.
      if (readId === null || readId === writeId) return w.name;
    }
    return null;
  }

  const contents: Content[] = [];
  for (let t = 0; t < history.length; t++) {
    const m = history[t];
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.content }] });
      continue;
    }
    // assistant turn — iterate replay slots so awaiting stubs are emitted too.
    // Indices align with the forward write-collection pass (same source array).
    const slots = replaySlotsByTurn[t];
    if (slots.length > 0) {
      // Model turn: every functionCall in order (real proposals + still-pending awaits).
      contents.push({
        role: "model",
        parts: slots.map((s) => ({
          functionCall: { name: s.tc.name, args: s.tc.args, id: s.tc.id },
        })) as Content["parts"],
      });
      // User turn: matching functionResponse parts.
      contents.push({
        role: "user",
        parts: slots.map((s, i) => {
          const tc = s.tc;
          let response: Record<string, unknown>;
          if (s.awaitingStub) {
            response = {
              status: "awaiting_user_approval",
              reason:
                "You already proposed this HITL-gated write. The user has not yet confirmed or cancelled it. Do NOT re-emit this call. Either continue with steps that don't depend on it, or wait silently for the user to decide.",
            };
          } else {
            const stale = staleReason(t, i, tc.name, tc.args);
            if (stale) {
              response = {
                status: "stale",
                reason: `invalidated by later ${stale}`,
              };
            } else if (tc.status === "done") {
              response = {
                summary: tc.output ?? "",
                citations: tc.citations?.length ?? 0,
              };
            } else {
              // error or running (running shouldn't appear on persisted records)
              response = {
                error: tc.error ?? "tool failed",
                summary: "",
              };
            }
          }
          return {
            functionResponse: { name: tc.name, id: tc.id, response },
          };
        }) as Content["parts"],
      });
    }
    if (m.content && m.content.length > 0) {
      contents.push({ role: "model", parts: [{ text: m.content }] });
    }
  }
  return contents;
}

export async function* orchestrate(
  query: string,
  history: Array<{ role: string; content: string; toolCalls?: PriorToolCall[] }>,
  uid: string,
  notebookId: string,
  sessionId: string | undefined,
  modelId: string,
  customSystemPrompt?: string,
  channel: "web" | "telegram" = "web",
  attachments?: ChatAttachment[],
  existingCacheName?: string
): AsyncGenerator<ChatChunk> {
  const c = getClient();
  const storeId = getGeminiStoreId();
  const userPickedModel = GEMINI_MODELS[modelId] || GEMINI_FALLBACK_MODEL;
  const metadataFilter = `notebook_id = "${notebookId}"`;

  console.log(`[ORCH] ---- New orchestrated query ----`);
  console.log(`[ORCH] notebookId=${notebookId}, model=${userPickedModel}`);
  console.log(`[ORCH] query="${query}"`);

  const contents: Content[] = reconstructHistory(history);
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

  // Ensure connectors registry is booted before reading enabled declarations.
  await bootConnectors();
  const builtInDecls = ALL_FUNCTION_DECLARATIONS;
  const connectorDecls = await getEnabledDeclarations(uid);
  // ask_user is always available — no provider gating, no scope check.
  const allDecls = [ASK_USER_DECL, ...builtInDecls, ...connectorDecls];
  const tools = [
    {
      fileSearch: {
        fileSearchStoreNames: [storeId],
        metadataFilter,
      },
    },
    { functionDeclarations: allDecls },
  ];
  const toolConfig = { includeServerSideToolInvocations: true };

  // ─── Context-cache prefix hash ─────────────────────────────────────────
  // Stable serialization of system + tool surface area. Truncate descriptions
  // so trivial wording tweaks don't blow the cache; name + truncated desc is
  // sufficient identity for the prefix.
  const prefixHash = createHash("sha256")
    .update(userPickedModel)
    .update("\n")
    .update(systemInstruction)
    .update("\n")
    .update(
      JSON.stringify(
        allDecls.map((d) => ({
          name: d.name,
          description: (d.description ?? "").slice(0, 100),
        }))
      )
    )
    .digest("hex");
  // Only honor the caller-supplied cache name if its hash matched at the
  // chat-handler layer; the handler is responsible for that gate. Here we
  // additionally tolerate stale/expired caches via try/catch fallback.
  let activeCacheName: string | undefined = existingCacheName;

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
      if (activeCacheName) {
        // Try the cached path first. systemInstruction + tools live in the
        // cache; do NOT resend them. toolConfig is not cacheable, so it's
        // omitted entirely (the cached tools carry their own server-side
        // invocation defaults).
        try {
          stream = await c.models.generateContentStream({
            model: modelToUse,
            contents,
            config: { cachedContent: activeCacheName },
          });
        } catch (cacheErr) {
          console.warn(
            `[ORCH] cache ${activeCacheName} unusable, falling back: ${
              cacheErr instanceof Error ? cacheErr.message : String(cacheErr)
            }`
          );
          activeCacheName = undefined;
          stream = await c.models.generateContentStream({
            model: modelToUse,
            contents,
            config: { systemInstruction, tools, toolConfig },
          });
        }
      } else {
        stream = await c.models.generateContentStream({
          model: modelToUse,
          contents,
          config: { systemInstruction, tools, toolConfig },
        });
      }
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

    // ─── ask_user short-circuit ───────────────────────────────────────────
    // If the model emitted ask_user (alone or alongside other calls), surface
    // the questions to the user and stop the turn. We do NOT dispatch any
    // sibling tools this turn — running write tools while we're also asking
    // for missing data would defeat the purpose. The model will pick up the
    // user's answers in the next turn (full history is preserved on l.~159–225).
    const askCall = calls.find((c) => c.name === "ask_user");
    if (askCall) {
      const args = askCall.args as {
        reason?: string;
        questions?: ClarificationQuestion[];
      };
      const questions = Array.isArray(args.questions) ? args.questions : [];
      const reason = String(args.reason ?? "I need a bit more information.");
      const clarificationId =
        askCall.id ??
        `ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      console.log(
        `[ORCH] turn=${turn} ask_user emitted with ${questions.length} question(s); halting turn`,
      );
      yield {
        type: "clarification_required",
        clarification: { clarificationId, reason, questions },
      };
      // Done. The agent's text (if any) is already streamed via "token" events.
      // No functionResponse, no further dispatch; conversation pauses here.
      break;
    }

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
      calls.map((call) => dispatch(call.name, call.args, { uid, sessionId }))
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
          // HITL proposals: the real result lands later via confirmPendingAction
          // as a separate synthetic message. Mark this one so history-replay
          // skips it and the model doesn't see the same write twice.
          ...(res.pendingAction ? { awaitingApproval: true } : {}),
        },
      };

      if (res.scopeRequired) {
        yield {
          type: "scope_expansion_required",
          scope: {
            provider: res.scopeRequired.provider,
            tool: res.scopeRequired.tool,
            missingScopes: res.scopeRequired.missingScopes,
          },
        };
        responseParts.push({
          functionResponse: {
            name: call.fullName,
            id: call.id,
            response: {
              status: "scope_expansion_required",
              provider: res.scopeRequired.provider,
              missingScopes: res.scopeRequired.missingScopes,
              message:
                "The user has not granted the permission required for this action. A 'Grant access' card has been shown in the chat. Briefly tell the user you need them to grant access via that card before you can proceed. Do not retry this tool this turn.",
            },
          },
        });
        continue;
      }

      if (res.pendingAction) {
        const expiresAt = Date.now() + 5 * 60 * 1000;
        yield {
          type: "action_approval_required",
          action: {
            actionId: res.pendingAction.actionId,
            provider: res.pendingAction.provider,
            tool: call.name,
            args: call.args,
            summary: res.pendingAction.summary,
            expiresAt,
          },
        };
        responseParts.push({
          functionResponse: {
            name: call.fullName,
            id: call.id,
            response: {
              status: "awaiting_user_approval",
              summary: res.pendingAction.summary,
              message:
                "The user must confirm this action via the approval card. Inform the user briefly that the card has been shown and you will execute upon their confirmation. Do not call any more tools this turn.",
            },
          },
        });
        continue;
      }

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
      // Don't leave the UI blank — surface a friendly explanation so the user
      // sees something instead of an empty assistant turn.
      yield {
        type: "token",
        text:
          "I've hit my tool-call limit for this turn before I could finish. " +
          "Could you ask me again, ideally with a bit more specificity so I take fewer steps?",
      };
    }
  }

  const allCitations = mergeAndDedupeCitations([
    ...fileSearchCitationGroups,
    ...subAgentCitationGroups,
  ]);
  if (allCitations.length > 0) {
    yield { type: "citations", citations: allCitations };
  }

  // ─── Context cache lifecycle ──────────────────────────────────────────
  // Always-on, graceful fallback. If we used an existing cache this session,
  // refresh its TTL. Otherwise (no cache, or it expired and we fell back),
  // create a fresh cache so the next turn pays a smaller prefix bill.
  // Failures here are non-fatal — caching is opportunistic.
  try {
    if (activeCacheName) {
      const refreshed = await c.caches.update({
        name: activeCacheName,
        config: { ttl: "3600s" },
      });
      const expiresAt = refreshed.expireTime
        ? Date.parse(refreshed.expireTime)
        : Date.now() + 3600_000;
      console.log(
        `[ORCH] cache refreshed: ${activeCacheName} (expiresAt=${new Date(expiresAt).toISOString()})`
      );
      yield {
        type: "cache_event",
        cache: { name: activeCacheName, hash: prefixHash, expiresAt },
      };
    } else {
      const created = await c.caches.create({
        model: modelToUse,
        config: {
          systemInstruction,
          tools,
          toolConfig,
          ttl: "3600s",
        },
      });
      if (created.name) {
        const expiresAt = created.expireTime
          ? Date.parse(created.expireTime)
          : Date.now() + 3600_000;
        console.log(
          `[ORCH] cache created: ${created.name} (model=${modelToUse}, tokens=${created.usageMetadata?.totalTokenCount ?? "?"}, expiresAt=${new Date(expiresAt).toISOString()})`
        );
        yield {
          type: "cache_event",
          cache: { name: created.name, hash: prefixHash, expiresAt },
        };
      } else {
        console.log("[ORCH] cache create returned no name — skipping persistence");
      }
    }
  } catch (err) {
    // Most common failure: INVALID_ARGUMENT when prefix < model min token count.
    console.log(
      `[ORCH] cache lifecycle skipped: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  yield { type: "done", totalTokens };
}
