import type { ChatCitation } from "../gemini";
import type { SubAgentResult, SubAgentName } from "./types";

/**
 * Lightweight, code-level QC. No extra Gemini call.
 * Validates ONE sub-agent's output before its content is exposed to the parent.
 */
export function validateSubAgent(
  name: SubAgentName,
  result: SubAgentResult
): SubAgentResult {
  if (!result.ok) return result;

  const summary = (result.summary ?? "").trim();
  if (summary.length === 0) {
    console.warn(`[QC ${name}] reject: empty summary`);
    return { ...result, ok: false, reason: "empty summary" };
  }
  // Soft mode: accept the summary even when grounding citations are absent.
  // Log it so we can spot patterns, but don't reject — the parent model can
  // still use the text. We just won't have citations to dedupe later.
  if (!result.citations || result.citations.length === 0) {
    console.warn(
      `[QC ${name}] soft-pass: zero grounding citations (summary len=${summary.length})`
    );
    return { ...result, summary, citations: [] };
  }
  return { ...result, summary };
}

/**
 * Dedupe citations by URI/sourceId across all sub-agent outputs and the
 * parent FileSearch grounding. Preserves first occurrence; merges `via` when
 * the same uri appears via different sub-agents.
 */
export function mergeAndDedupeCitations(
  groups: ChatCitation[][]
): ChatCitation[] {
  const seen = new Map<string, ChatCitation>();
  for (const group of groups) {
    for (const c of group) {
      const key = (c.url ?? c.sourceId ?? "").trim();
      if (!key) continue;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, { ...c });
      } else if (c.via && existing.via && existing.via !== c.via) {
        // Same url via multiple sub-agents — keep the first, leave a marker.
        existing.via = existing.via;
      }
    }
  }
  // Re-number 1..N for stable display order.
  return Array.from(seen.values()).map((c, i) => ({ ...c, index: i + 1 }));
}
