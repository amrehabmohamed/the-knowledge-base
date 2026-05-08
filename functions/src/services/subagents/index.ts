import type { SubAgentName, SubAgentResult } from "./types";
import { webSearch } from "./web_search";
import { mapsSearch } from "./maps_search";
import { urlFetch } from "./url_fetch";
import { validateSubAgent } from "./qc";

export type { SubAgentName, SubAgentResult } from "./types";
export { ALL_FUNCTION_DECLARATIONS } from "./declarations";
export { mergeAndDedupeCitations, validateSubAgent } from "./qc";

const KNOWN: Record<SubAgentName, true> = {
  web_search: true,
  maps_search: true,
  url_fetch: true,
};

export function isSubAgentName(n: string): n is SubAgentName {
  return Object.prototype.hasOwnProperty.call(KNOWN, n);
}

/**
 * Routes a function call from the parent model to the matching sub-agent
 * and runs lightweight QC on the result. The dispatcher is the ONLY place
 * that maps a function name to an implementation — sub-agents themselves
 * never know about each other.
 */
export async function dispatch(
  name: string,
  args: Record<string, unknown>
): Promise<SubAgentResult> {
  if (!isSubAgentName(name)) {
    return {
      ok: false,
      summary: "",
      citations: [],
      rawTokens: 0,
      reason: `unknown sub-agent: ${name}`,
    };
  }

  let raw: SubAgentResult;
  switch (name) {
    case "web_search":
      raw = await webSearch({ query: String(args.query ?? "") });
      break;
    case "maps_search":
      raw = await mapsSearch({
        query: String(args.query ?? ""),
        latLng: args.latLng as { latitude: number; longitude: number } | undefined,
      });
      break;
    case "url_fetch":
      raw = await urlFetch({
        urls: Array.isArray(args.urls) ? (args.urls as string[]) : [],
        question: args.question ? String(args.question) : undefined,
      });
      break;
  }
  return validateSubAgent(name, raw);
}
