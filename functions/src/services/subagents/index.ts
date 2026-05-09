import type { SubAgentName, SubAgentResult } from "./types";
import { webSearch } from "./web_search";
import { mapsSearch } from "./maps_search";
import { urlFetch } from "./url_fetch";
import { validateSubAgent } from "./qc";
import { dispatch as connectorDispatch } from "../connectors";

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
  args: Record<string, unknown>,
  ctx: { uid: string; sessionId?: string }
): Promise<SubAgentResult> {
  if (!isSubAgentName(name)) {
    // Try connector registry.
    try {
      const result = await connectorDispatch(name, args, ctx);
      if (result.kind === "result") {
        const summary = JSON.stringify(result.data, null, 2).slice(0, 8000);
        return { ok: true, summary, citations: [], rawTokens: 0 };
      }
      if (result.kind === "validation_pending") {
        // Surface as a normal tool result so the parent model sees the
        // missing-fields payload and can ask the user in chat.
        const payload = {
          status: "validation_pending",
          provider: result.provider,
          tool: result.tool,
          missing: result.missing,
          message: result.message,
        };
        return {
          ok: true,
          summary: JSON.stringify(payload, null, 2),
          citations: [],
          rawTokens: 0,
        };
      }
      if (result.kind === "scope_required") {
        return {
          ok: true,
          summary:
            `Additional permission required to run ${result.tool}. ` +
            `The user has been shown a card to grant access to ${result.provider}. ` +
            `Tell the user to click the Grant access button. Do not call this tool again until they grant access.`,
          citations: [],
          rawTokens: 0,
          scopeRequired: {
            provider: result.provider,
            tool: result.tool,
            missingScopes: result.missingScopes,
          },
        };
      }
      // awaiting_approval
      return {
        ok: true,
        summary: "Action awaiting user approval: " + result.summary,
        citations: [],
        rawTokens: 0,
        pendingAction: {
          actionId: result.actionId,
          summary: result.summary,
          provider: result.provider,
        },
      };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && "message" in err
            ? String((err as { message?: unknown }).message)
            : String(err);
      console.error(`[CONNECTOR] ${name} failed:`, msg, err);
      if (/unknown tool/i.test(msg)) {
        return {
          ok: false,
          summary: "",
          citations: [],
          rawTokens: 0,
          reason: `unknown sub-agent: ${name}`,
        };
      }
      return {
        ok: false,
        summary: "",
        citations: [],
        rawTokens: 0,
        reason: msg,
      };
    }
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
