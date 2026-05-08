import type { SubAgentResult } from "./types";
import { runSingleTool } from "./runSingleTool";

export interface UrlFetchArgs {
  urls: string[];
  /** Optional question to focus the summary on. */
  question?: string;
}

/** Sub-agent: ONE task, ONE tool. URL Context only. */
export async function urlFetch(args: UrlFetchArgs): Promise<SubAgentResult> {
  const urls = (args?.urls ?? []).map((u) => u?.trim()).filter(Boolean);
  if (urls.length === 0) {
    return { ok: false, summary: "", citations: [], rawTokens: 0, reason: "no urls" };
  }
  try {
    const focus = args.question?.trim()
      ? `Question: ${args.question.trim()}\n\n`
      : "";
    const prompt = `${focus}Fetch and summarize the following URLs. Cite each URL you use:\n${urls
      .map((u) => `- ${u}`)
      .join("\n")}`;
    const { text, citations, totalTokens } = await runSingleTool({
      prompt,
      tool: { urlContext: {} },
      via: "url",
    });
    return { ok: true, summary: text, citations, rawTokens: totalTokens };
  } catch (err) {
    const message = err instanceof Error ? err.message : "url_fetch failed";
    console.error("[SUBAGENT url_fetch] error:", err);
    return { ok: false, summary: "", citations: [], rawTokens: 0, reason: message };
  }
}
