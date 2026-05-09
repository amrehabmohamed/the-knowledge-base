import type { SubAgentResult } from "./types";
import { runSingleTool } from "./runSingleTool";

export interface WebSearchArgs {
  query: string;
}

/** Sub-agent: ONE task, ONE tool. Google web search only. */
export async function webSearch(args: WebSearchArgs): Promise<SubAgentResult> {
  if (!args?.query || !args.query.trim()) {
    return { ok: false, summary: "", citations: [], rawTokens: 0, reason: "empty query" };
  }
  try {
    const { text, citations, totalTokens } = await runSingleTool({
      prompt: args.query,
      tool: { googleSearch: {} },
      via: "web",
    });
    return { ok: true, summary: text, citations, rawTokens: totalTokens };
  } catch (err) {
    const message = err instanceof Error ? err.message : "web_search failed";
    console.error("[SUBAGENT web_search] error:", err);
    return { ok: false, summary: "", citations: [], rawTokens: 0, reason: message };
  }
}
