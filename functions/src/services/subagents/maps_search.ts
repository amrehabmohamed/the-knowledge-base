import type { SubAgentResult } from "./types";
import { runSingleTool } from "./runSingleTool";

export interface MapsSearchArgs {
  query: string;
  latLng?: { latitude: number; longitude: number };
}

/** Sub-agent: ONE task, ONE tool. Google Maps grounding only. */
export async function mapsSearch(args: MapsSearchArgs): Promise<SubAgentResult> {
  if (!args?.query || !args.query.trim()) {
    return { ok: false, summary: "", citations: [], rawTokens: 0, reason: "empty query" };
  }
  const tool: Record<string, unknown> = { googleMaps: {} };
  if (args.latLng) {
    (tool.googleMaps as Record<string, unknown>) = { latLng: args.latLng };
  }
  try {
    const prompt = args.latLng
      ? `${args.query}\n(Center map results near lat=${args.latLng.latitude}, lng=${args.latLng.longitude}.)`
      : args.query;
    const { text, citations, totalTokens } = await runSingleTool({
      prompt,
      tool,
      via: "maps",
    });
    return { ok: true, summary: text, citations, rawTokens: totalTokens };
  } catch (err) {
    const message = err instanceof Error ? err.message : "maps_search failed";
    console.error("[SUBAGENT maps_search] error:", err);
    return { ok: false, summary: "", citations: [], rawTokens: 0, reason: message };
  }
}
