import { GoogleGenAI } from "@google/genai";
import { getGeminiApiKey, GEMINI_SUBAGENT_MODEL } from "../../config";
import type { ChatCitation } from "../gemini";
import type { CitationVia } from "./types";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  return client;
}

interface RunArgs {
  prompt: string;
  tool: Record<string, unknown>;
  via: CitationVia;
  systemInstruction?: string;
}

interface RunResult {
  text: string;
  citations: ChatCitation[];
  totalTokens: number;
}

/**
 * Single Gemini call with exactly one built-in tool. Used by sub-agents.
 * No streaming (sub-agents are atomic). Returns text + grounded citations.
 */
export async function runSingleTool(args: RunArgs): Promise<RunResult> {
  const c = getClient();
  const response = await c.models.generateContent({
    model: GEMINI_SUBAGENT_MODEL,
    contents: [{ role: "user", parts: [{ text: args.prompt }] }],
    config: {
      systemInstruction:
        args.systemInstruction ??
        "You are a single-purpose retrieval sub-agent. Use your tool to gather grounded information for the parent agent. Reply with a concise factual summary. Do not invent information.",
      tools: [args.tool],
    },
  });

  const candidate = (response.candidates ?? [])[0] as
    | Record<string, unknown>
    | undefined;
  const text =
    response.text ??
    ((candidate?.content as Record<string, unknown> | undefined)?.parts as
      | Array<{ text?: string }>
      | undefined)
      ?.map((p) => p.text ?? "")
      .join("") ??
    "";

  const usage = (response as unknown as { usageMetadata?: { totalTokenCount?: number } })
    .usageMetadata;
  const totalTokens = usage?.totalTokenCount ?? 0;

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

  if (groundingChunks && groundingSupports) {
    groundingSupports.forEach((support) => {
      const idxs = (support.groundingChunkIndices as number[]) ?? [];
      const segment = support.segment as Record<string, unknown> | undefined;
      const chunkText = (segment?.text as string) ?? "";
      for (const i of idxs) {
        const ch = groundingChunks[i];
        const web = ch?.web as { uri?: string; title?: string } | undefined;
        if (web?.uri) {
          citations.push({
            index: citations.length + 1,
            sourceId: web.uri,
            sourceName: web.title ?? "Web source",
            chunkText,
            type: "web",
            url: web.uri,
            via: args.via,
          });
        }
      }
    });
  }

  return { text, citations, totalTokens };
}
