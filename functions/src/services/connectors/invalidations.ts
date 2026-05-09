/**
 * Write→read invalidation map for the orchestrator's history-replay layer.
 *
 * When the orchestrator rebuilds history from prior turns and finds a write
 * tool call, it consults this map to decide which earlier read tool calls
 * are now stale and should NOT be replayed (so the model knows to re-fetch).
 *
 * Granularity:
 *   - GLOBAL: any earlier call to the listed read tool, regardless of args,
 *     is invalidated (e.g. crm_create_lead invalidates ALL crm_list_leads).
 *   - PER_RESOURCE: only earlier calls whose resource id matches the write's
 *     resource id are invalidated. The map provides the matcher fn.
 *
 * Built-in sub-agents (web_search, maps_search, url_fetch) have NO
 * invalidations — they don't mutate state. They are intentionally absent.
 */

export type Invalidation =
  | { kind: "global"; reads: readonly string[] }
  | {
      kind: "per_resource";
      reads: readonly string[];
      /**
       * Returns the resource id this write targets, given the write's args.
       * Returns null if the args don't carry a resource id (no invalidation).
       */
      writeResourceId: (writeArgs: Record<string, unknown>) => string | null;
      /**
       * Returns the resource id a prior read pertains to. For per-resource
       * reads (e.g. crm_get_lead), this is the leadId in the read's args.
       * For list-style reads (e.g. crm_list_leads), it should return null
       * meaning "this read pertains to ALL resources of this type" — and the
       * orchestrator should invalidate it on ANY per-resource write.
       */
      readResourceId: (readToolName: string, readArgs: Record<string, unknown>) => string | null;
    };

/**
 * Per-tenant lead-resource id extractors. crm_get_lead carries leadId in args;
 * lists carry no per-id, so invalidating any list when any lead changes is the
 * conservative-but-correct default.
 */
function leadIdFromArgs(args: Record<string, unknown>): string | null {
  const v = args?.leadId;
  return typeof v === "string" && v.length > 0 ? v : null;
}
function listLeadsTargetsAnyLead(name: string): string | null {
  // Lists have no specific id — return null so they invalidate on ANY lead write.
  return name === "crm_list_leads" ? null : null;
}

export const INVALIDATIONS: Record<string, Invalidation> = {
  // ─── Lead writes ───────────────────────────────────────────────
  // Create produces a new lead → any prior list is now stale.
  crm_create_lead: {
    kind: "global",
    reads: ["crm_list_leads"],
  },
  // Per-resource updates: invalidate the matching crm_get_lead AND any
  // crm_list_leads (lists may include the changed lead).
  crm_update_lead: {
    kind: "per_resource",
    reads: ["crm_get_lead", "crm_list_leads"],
    writeResourceId: leadIdFromArgs,
    readResourceId: (name, args) =>
      name === "crm_get_lead" ? leadIdFromArgs(args) : listLeadsTargetsAnyLead(name),
  },
  crm_assign_lead: {
    kind: "per_resource",
    reads: ["crm_get_lead", "crm_list_leads"],
    writeResourceId: leadIdFromArgs,
    readResourceId: (name, args) =>
      name === "crm_get_lead" ? leadIdFromArgs(args) : listLeadsTargetsAnyLead(name),
  },
  crm_transition_stage: {
    kind: "per_resource",
    reads: ["crm_get_lead", "crm_list_leads"],
    writeResourceId: leadIdFromArgs,
    readResourceId: (name, args) =>
      name === "crm_get_lead" ? leadIdFromArgs(args) : listLeadsTargetsAnyLead(name),
  },

  // ─── Stage writes ──────────────────────────────────────────────
  // Stage shape changes affect the whole pipeline; lists become stale globally.
  crm_create_stage: { kind: "global", reads: ["crm_list_stages"] },
  crm_update_stage: { kind: "global", reads: ["crm_list_stages"] },
  crm_delete_stage: { kind: "global", reads: ["crm_list_stages"] },

  // ─── Custom field writes ───────────────────────────────────────
  crm_create_custom_field: { kind: "global", reads: ["crm_list_custom_fields"] },
  crm_update_custom_field: { kind: "global", reads: ["crm_list_custom_fields"] },
  crm_delete_custom_field: { kind: "global", reads: ["crm_list_custom_fields"] },
};

/**
 * True when the given tool name is a known write that has invalidations declared.
 * Convenience for the orchestrator's history walk.
 */
export function isWrite(toolName: string): boolean {
  return Object.prototype.hasOwnProperty.call(INVALIDATIONS, toolName);
}
