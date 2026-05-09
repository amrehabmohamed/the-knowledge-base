import type { ConnectorContext, ConnectorTool } from "../types";
import { ValidationPendingError } from "../types";
import type { TechTraxClient } from "./client";
import { getSchema, invalidateSchema } from "./schemaCache";
import {
  routeCreateFields,
  routeUpdateFields,
  validateCreate,
  validateTransition,
} from "./validator";
import { normalizePhoneToE164 } from "./phone";
import { parseDateTimeToIso } from "../dateTime";
import { requestWithEnumRetry } from "./caseCorrect";

/**
 * CRM lead fields that semantically carry a date or datetime. When the agent
 * supplies these as natural language ("tomorrow", "next Monday 10am") we
 * normalize them to RFC3339 / YYYY-MM-DD on their behalf.
 *   - DOB is date-only (YYYY-MM-DD).
 *   - everything else is full datetime.
 */
const DATETIME_FIELDS = new Set<string>([
  "bookingDate",
  "snoozeDate",
  "followUpDate",
  "appointmentDate",
  "meetingDate",
]);
const DATE_ONLY_FIELDS = new Set<string>(["DOB", "dob", "birthDate"]);

/**
 * Refresh `ctx.lockToken` from a fresh GET right before a write. Optimistic
 * locking on the Tech Trax backend uses `If-Unmodified-Since`; the token
 * captured during preflight is stale by the time the user clicks Confirm
 * (HITL approval window) AND between chained writes (PATCH then transition).
 * Re-fetching pulls a fresh token without throwing away the user's approval —
 * we just commit the approved change against the latest version of the lead.
 */
async function refreshLockToken(
  c: TechTraxClient,
  leadId: string,
  ctx: ConnectorContext
): Promise<void> {
  try {
    const r = await c.request<any>({
      method: "GET",
      path: `/api/crm/leads/${encodeURIComponent(String(leadId))}`,
    });
    if (r.lastModified) ctx.lockToken = r.lastModified;
  } catch {
    // If the GET fails we keep whatever token preflight stashed.
  }
}

/**
 * Self-verification helper for write handlers. After a successful write the
 * backend almost always echoes the new resource — we use that echo to assert
 * the mutation actually took effect, instead of trusting "200 OK" blindly
 * (idempotent middleware, partial server-side merge logic, and "soft success"
 * responses can all return 200 without applying the change). On mismatch we
 * throw `verification_failed` so the agent's summary doesn't lie.
 *
 * `expected` is what the agent intended; `actual` is what the response shows.
 * Equality is loose (string-coerced) because Mongo ObjectIds, Dates, and
 * stringly-typed enums all flow through this code path.
 */
function verify(
  ok: boolean,
  message: string,
  details?: Record<string, unknown>,
): void {
  if (ok) return;
  throw {
    code: "verification_failed",
    message: `Write succeeded but backend response doesn't reflect the change: ${message}`,
    retryable: false,
    details,
  };
}

function eqIdLike(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  return String(a).trim() === String(b).trim();
}

/**
 * Pulls the canonical id out of a value that could be a string id, a populated
 * object `{_id: ...}`, or a `{id: ...}` shape. Returns "" when nothing usable.
 */
function pickId(v: any): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") return String(v._id ?? v.id ?? "");
  return "";
}

/**
 * Wrap a write that uses `ifUnmodifiedSince` so that a `precondition_failed`
 * (HTTP 412) triggers exactly one refresh-and-retry. This is the fix for
 * concurrent HITL actions on the same lead: the agent often emits e.g.
 * `crm_assign_lead` + `crm_transition_stage` in parallel, the user approves
 * them sequentially, and the second action's preflight-time lock token is
 * stale by the time it executes (the first action just bumped Last-Modified).
 *
 * We only retry on 412 — any other error bubbles up unchanged. We retry
 * once: if the second attempt also 412s, there's a real conflict (likely a
 * human edit between our refresh and our write) and the user should retry
 * the whole flow rather than us looping silently.
 *
 * @param mutate Builds the request body. Called fresh on each attempt so
 *   anything dependent on `ctx.lockToken` (which we update between attempts)
 *   sees the latest value.
 */
async function executeWithLockRetry<T>(
  c: TechTraxClient,
  ctx: ConnectorContext,
  leadId: string,
  mutate: () => Promise<T>
): Promise<T> {
  try {
    return await mutate();
  } catch (err: any) {
    if (err?.code !== "precondition_failed") throw err;
    console.warn(
      `[tech_trax_crm] precondition_failed on lead ${leadId}; refreshing lock and retrying once.`
    );
    await refreshLockToken(c, leadId, ctx);
    return await mutate();
  }
}

/**
 * Concise, human-readable summary of the fields the agent is allowed to set
 * on a lead update for this tenant. Used in coaching errors when the agent
 * passes an unknown key (e.g. `close_date`) so it can retry with the right
 * one without us having to enumerate every column shape.
 */
function buildKnownFieldList(schema: import("./schemaCache").TechTraxSchema): string {
  const TOP = ["firstName", "lastName", "email", "phone", "gender", "DOB", "nationality", "address", "source"];
  const CRM = [
    "assignedTo", "priority", "preferredBookingType", "preferredDoctor",
    "lastCallOutcome", "followUpCount", "bookingDate", "snoozeDate",
    "customerInterestId", "nonBuyingReasonId", "nonBuyingReasonComment",
  ];
  const customs = (schema.customFields ?? []).map((f) =>
    f.label && f.label !== f.fieldName ? `${f.fieldName} (“${f.label}”)` : f.fieldName,
  );
  const sections: string[] = [];
  sections.push(`top-level: ${TOP.join(", ")}`);
  sections.push(`crm subdoc: ${CRM.join(", ")}`);
  if (customs.length > 0) sections.push(`custom: ${customs.join(", ")}`);
  return sections.join(" | ");
}

function normalizeDateLikeFields(obj: Record<string, any> | undefined): void {
  if (!obj) return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v !== "string" || !v.trim()) continue;
    try {
      if (DATE_ONLY_FIELDS.has(k)) {
        obj[k] = parseDateTimeToIso(v, { dateOnly: true });
      } else if (DATETIME_FIELDS.has(k)) {
        obj[k] = parseDateTimeToIso(v);
      }
    } catch {
      // Leave the original value — backend Joi will reject and the enriched
      // error helper will surface why.
    }
  }
}
import {
  CRM_ASSIGN_LEAD_DECL,
  CRM_CREATE_CUSTOM_FIELD_DECL,
  CRM_CREATE_LEAD_DECL,
  CRM_CREATE_STAGE_DECL,
  CRM_DELETE_CUSTOM_FIELD_DECL,
  CRM_DELETE_STAGE_DECL,
  CRM_GET_LEAD_DECL,
  CRM_LIST_CUSTOM_FIELDS_DECL,
  CRM_LIST_LEADS_DECL,
  CRM_LIST_STAGES_DECL,
  CRM_LIST_USERS_DECL,
  CRM_TRANSITION_STAGE_DECL,
  CRM_UPDATE_CUSTOM_FIELD_DECL,
  CRM_UPDATE_LEAD_DECL,
  CRM_UPDATE_STAGE_DECL,
} from "./declarations";

/**
 * The Tech Trax backend wraps responses with `{ success, data, message, pagination? }`.
 * This helper unwraps the `data` field for return values; if the body isn't shaped
 * that way (e.g. raw array) we return it as-is.
 */
function unwrap<T = any>(body: any): T {
  if (body && typeof body === "object" && "data" in body) return body.data as T;
  return body as T;
}

function client(ctx: ConnectorContext): TechTraxClient {
  return ctx.client as TechTraxClient;
}

// ─── Read handlers ──────────────────────────────────────────────────────────

export async function handleListStages(_args: any, ctx: ConnectorContext) {
  const schema = await getSchema(ctx.uid, client(ctx));
  return { stages: schema.stages };
}

export async function handleListLeads(args: any, ctx: ConnectorContext) {
  const c = client(ctx);
  const limit = args?.limit !== undefined
    ? Math.min(Math.max(1, Number(args.limit)), 100)
    : 20;
  const page = args?.page !== undefined ? Math.max(1, Number(args.page)) : 1;
  const query: Record<string, string | number | boolean | undefined> = {
    page,
    limit,
  };
  if (args?.stageId) query.stageId = String(args.stageId);
  if (args?.search) query.search = String(args.search);
  // Tech Trax listLeadsSchema doesn't currently support assignedToMe; we still pass
  // it as a hint — backend's stripUnknown drops unknown keys safely.
  if (args?.assignedToMe) query.assignedToMe = true;
  const resp = await c.request<any>({ method: "GET", path: "/api/crm/leads", query });
  const body = resp.data;
  const data = unwrap(body);
  const pagination = body && typeof body === "object" ? (body as any).pagination : undefined;
  return { leads: data, pagination };
}

export async function handleGetLead(args: any, ctx: ConnectorContext) {
  if (!args?.leadId) {
    throw { code: "invalid_argument", message: "leadId is required", retryable: false };
  }
  const c = client(ctx);
  const resp = await c.request<any>({
    method: "GET",
    path: `/api/crm/leads/${encodeURIComponent(String(args.leadId))}`,
  });
  return { lead: unwrap(resp.data) };
}

// ─── Write handlers ─────────────────────────────────────────────────────────

export async function handleCreateLead(args: any, ctx: ConnectorContext) {
  const c = client(ctx);
  const schema = await getSchema(ctx.uid, c);
  // Args from the agent come as a flat record. Pull off the well-known
  // top-level params explicitly and route any extra keys via the schema map.
  const flatExtras: Record<string, any> = { ...(args ?? {}) };
  for (const k of [
    "firstName",
    "lastName",
    "phone",
    "email",
    "source",
    "priority",
    "assignedToUserId",
  ]) {
    delete flatExtras[k];
  }
  const routed = routeCreateFields({ fields: flatExtras, schema });
  const phoneE164 = normalizePhoneToE164(args.phone);
  // Normalize natural-language dates anywhere the agent stuck them on the
  // input (top-level extras and any custom-field-shaped values get
  // normalized in their respective routed buckets below).
  normalizeDateLikeFields(args);
  normalizeDateLikeFields(routed.topLevel);
  const body: Record<string, any> = {
    firstName: args.firstName,
    lastName: args.lastName,
    phone: phoneE164,
    email: args.email,
    ...routed.topLevel,
  };
  // If routed.topLevel happened to carry a `phone` (shouldn't, but be safe),
  // overwrite with the normalized value.
  body.phone = phoneE164;
  if (args.priority) body.priority = args.priority;
  if (args.assignedToUserId) body.assignedTo = args.assignedToUserId;
  if (args.source) body.source = { channel: String(args.source) };
  if (routed.customFields.length > 0) body.customFields = routed.customFields;
  if (routed.unrouted.length > 0) {
    console.warn(
      `[tech_trax_crm.handleCreateLead] Dropping unroutable fields: ${routed.unrouted.join(", ")}`
    );
  }
  const resp = await requestWithEnumRetry<any>(c, {
    method: "POST",
    path: "/api/crm/leads",
    body,
    idempotencyKey: ctx.idempotencyKey,
  });
  const created = unwrap(resp.data) as any;
  // Verify the backend stored the core identity fields we sent.
  verify(
    !!created && !!created._id,
    "create response had no lead._id",
    { actual: created },
  );
  verify(
    eqIdLike(created.firstName, body.firstName) &&
      eqIdLike(created.lastName, body.lastName),
    "name in response doesn't match what was sent",
    { expected: { firstName: body.firstName, lastName: body.lastName }, actual: { firstName: created.firstName, lastName: created.lastName } },
  );
  if (body.email) {
    verify(
      eqIdLike(created.email, body.email),
      "email in response doesn't match what was sent",
      { expected: body.email, actual: created.email },
    );
  }
  return { lead: created };
}

export async function handleUpdateLead(args: any, ctx: ConnectorContext) {
  if (!args?.leadId) {
    throw { code: "invalid_argument", message: "leadId is required", retryable: false };
  }
  const c = client(ctx);
  await refreshLockToken(c, String(args.leadId), ctx);
  const schema = await getSchema(ctx.uid, c);
  const { topLevel, crm, customFields, unrouted } = routeUpdateFields({
    fields: args.fields ?? {},
    schema,
  });
  const body: Record<string, any> = { ...topLevel };
  // Normalize a phone update to E.164 before posting.
  if (typeof body.phone === "string" && body.phone.length > 0) {
    body.phone = normalizePhoneToE164(body.phone);
  }
  // Normalize date-shaped fields on the top-level body, the crm subdoc, and
  // any custom-field values that look like dates by name.
  normalizeDateLikeFields(body);
  normalizeDateLikeFields(crm);
  if (Object.keys(crm).length > 0) body.crm = crm;
  if (customFields.length > 0) body.customFields = customFields;
  if (unrouted.length > 0) {
    console.warn(
      `[tech_trax_crm.handleUpdateLead] Dropping unroutable fields: ${unrouted.join(", ")}`
    );
  }
  // Hard stop if every key the agent passed got dropped — sending an empty
  // PATCH would let the backend reject with the un-actionable
  // `"value" must have at least 1 key`. Coach the agent with the real field
  // catalog so it can retry with the right key (e.g. close_date → followUpDate).
  if (Object.keys(body).length === 0) {
    const known = buildKnownFieldList(schema);
    throw {
      code: "validation_error",
      message:
        `None of the supplied fields (${unrouted.join(", ") || "(none)"}) are recognized for this tenant. ` +
        `Valid update fields are: ${known}. Ask the user which field they meant and retry.`,
      retryable: false,
    };
  }
  const resp = await executeWithLockRetry(c, ctx, String(args.leadId), () =>
    requestWithEnumRetry<any>(c, {
      method: "PATCH",
      path: `/api/crm/leads/${encodeURIComponent(String(args.leadId))}`,
      body,
      idempotencyKey: ctx.idempotencyKey,
      ifUnmodifiedSince: ctx.lockToken,
    }),
  );
  const updated = unwrap(resp.data) as any;
  // Walk every key we sent and confirm the response shows it. Top-level and
  // crm-subdoc fields can be checked directly; customFields[] needs its own
  // path. Loose equality (string-coerce) handles dates, ObjectIds, enums.
  if (updated && typeof updated === "object") {
    for (const [k, v] of Object.entries(body)) {
      if (k === "crm" || k === "customFields") continue;
      if (v === undefined) continue;
      verify(
        eqIdLike(updated[k], v),
        `top-level field "${k}" not reflected in response`,
        { expected: v, actual: updated[k] },
      );
    }
    if (body.crm && typeof body.crm === "object" && updated.crm) {
      for (const [k, v] of Object.entries(body.crm)) {
        if (v === undefined) continue;
        const got = updated.crm[k];
        verify(
          eqIdLike(pickId(got) || got, pickId(v) || v),
          `crm.${k} not reflected in response`,
          { expected: v, actual: got },
        );
      }
    }
    if (Array.isArray(body.customFields) && Array.isArray(updated.customFields)) {
      for (const cf of body.customFields) {
        const hit = updated.customFields.find((x: any) => eqIdLike(x?.fieldId ?? x?._id, cf.fieldId));
        verify(
          !!hit && eqIdLike(hit.value, cf.value),
          `customField ${cf.fieldId} not reflected in response`,
          { expected: cf, actual: hit },
        );
      }
    }
  }
  return { lead: updated };
}

export async function handleTransitionStage(args: any, ctx: ConnectorContext) {
  if (!args?.leadId || !args?.toStageId) {
    throw {
      code: "invalid_argument",
      message: "leadId and toStageId are required",
      retryable: false,
    };
  }
  const c = client(ctx);
  // Fresh lock token: the preflight one may be 30s+ old by the time the user
  // clicks Confirm. Re-GETting commits the approved change against the
  // current revision of the lead.
  await refreshLockToken(c, String(args.leadId), ctx);
  const baseKey = ctx.idempotencyKey;
  const fieldUpdates = args.fieldUpdates as Record<string, any> | undefined;
  let fieldsUpdated: string[] = [];
  let fieldsDropped: string[] = [];

  if (fieldUpdates && Object.keys(fieldUpdates).length > 0) {
    const schema = await getSchema(ctx.uid, c);
    const { topLevel, crm, customFields, unrouted } = routeUpdateFields({
      fields: fieldUpdates,
      schema,
    });
    const patchBody: Record<string, any> = { ...topLevel };
    if (Object.keys(crm).length > 0) patchBody.crm = crm;
    if (customFields.length > 0) patchBody.customFields = customFields;
    if (unrouted.length > 0) {
      console.warn(
        `[tech_trax_crm.handleTransitionStage] Dropping unroutable fields: ${unrouted.join(", ")}`
      );
      fieldsDropped = unrouted.slice();
    }
    // Only PATCH if the routed body has at least one key. If every field went
    // to `unrouted`, the schema cache didn't recognize any of them — sending
    // an empty {} would make the backend's Joi reject with
    // "value must have at least 1 key", which then masks the real problem.
    // Proceed straight to the transition; the agent gets `fieldsDropped` in
    // the response and can recover.
    if (Object.keys(patchBody).length > 0) {
      // Normalize date-shaped values inside the patch body.
      normalizeDateLikeFields(patchBody);
      normalizeDateLikeFields(crm);
      const patchResp = await executeWithLockRetry(c, ctx, String(args.leadId), () =>
        requestWithEnumRetry<any>(c, {
          method: "PATCH",
          path: `/api/crm/leads/${encodeURIComponent(String(args.leadId))}`,
          body: patchBody,
          idempotencyKey: baseKey ? `${baseKey}:patch` : undefined,
          ifUnmodifiedSince: ctx.lockToken,
        }),
      );
      // Update the lock token before the transition POST — the lead's
      // Last-Modified just bumped, the cached token is one tick stale.
      if (patchResp.lastModified) ctx.lockToken = patchResp.lastModified;
      fieldsUpdated = Object.keys(fieldUpdates).filter(
        (k) => !unrouted.includes(k)
      );
    } else {
      console.warn(
        `[tech_trax_crm.handleTransitionStage] All field updates were unrouted; skipping PATCH and proceeding to transition.`
      );
    }
  }

  const transitionBody: Record<string, any> = { toStageId: args.toStageId };
  if (args.reason) transitionBody.reason = args.reason;
  const transitionResp = await executeWithLockRetry(c, ctx, String(args.leadId), () =>
    requestWithEnumRetry<any>(c, {
      method: "POST",
      path: `/api/crm/leads/${encodeURIComponent(String(args.leadId))}/transition`,
      body: transitionBody,
      idempotencyKey: baseKey ? `${baseKey}:transition` : undefined,
      ifUnmodifiedSince: ctx.lockToken,
    }),
  );
  const transition = unwrap(transitionResp.data) as any;
  // The transition endpoint can return either the lead doc or a wrapper
  // like {lead, transition}. Prefer the most-specific shape we can find.
  const newStageId =
    pickId(transition?.lead?.crm?.stageId) ||
    pickId(transition?.crm?.stageId) ||
    pickId(transition?.stageId) ||
    pickId(transition?.toStageId);
  verify(
    eqIdLike(newStageId, args.toStageId),
    `lead.crm.stageId did not change to the requested target stage`,
    { expected: args.toStageId, actual: newStageId, body: transition },
  );
  return {
    transition,
    fieldsUpdated,
    fieldsDropped,
  };
}

export async function handleAssignLead(args: any, ctx: ConnectorContext) {
  if (!args?.leadId || !args?.assigneeUserId) {
    throw {
      code: "invalid_argument",
      message: "leadId and assigneeUserId are required",
      retryable: false,
    };
  }
  const c = client(ctx);
  const resolvedAssignee = resolveAssignee(c, args.assigneeUserId);
  await refreshLockToken(c, String(args.leadId), ctx);
  const resp = await executeWithLockRetry(c, ctx, String(args.leadId), () =>
    c.request<any>({
      method: "POST",
      path: `/api/crm/leads/${encodeURIComponent(String(args.leadId))}/assign`,
      body: { assignedTo: resolvedAssignee },
      idempotencyKey: ctx.idempotencyKey,
      ifUnmodifiedSince: ctx.lockToken,
    }),
  );
  const lead = unwrap(resp.data) as any;
  const actualAssignee = pickId(lead?.crm?.assignedTo) || pickId(lead?.assignedTo);
  verify(
    eqIdLike(actualAssignee, resolvedAssignee),
    `lead.crm.assignedTo did not change to the requested user`,
    { expected: resolvedAssignee, actual: actualAssignee },
  );
  return { lead };
}

// ─── Preflight hooks ────────────────────────────────────────────────────────

export async function preflightCreateLead(args: any, _ctx: ConnectorContext): Promise<void> {
  const v = validateCreate(args);
  if (!v.ok) {
    throw new ValidationPendingError(v.missing, v.message ?? "Missing required fields");
  }
  // Normalize phone to E.164 BEFORE the agent proposes an approval card. We
  // accept local Egyptian numbers (auto-prefixed to +20) and any valid
  // international format. Mutating args.phone here means:
  //   - the approval card preview shows the canonical E.164 number,
  //   - the pendingAction doc stores the normalized form, so on Confirm the
  //     handler runs with consistent input,
  //   - junk input fails fast as a ValidationPendingError so the agent can
  //     re-ask the user instead of going through the full HITL approve→fail.
  if (args?.phone) {
    try {
      args.phone = normalizePhoneToE164(String(args.phone));
    } catch (e: any) {
      throw new ValidationPendingError(
        [{ key: "phone", label: "Phone (international, e.g. +201012345678)", type: "string" }],
        e?.message ?? "Phone number is not valid"
      );
    }
  }
}

/**
 * Fetches the lead so the caller has a fresh `Last-Modified` to use as the
 * optimistic-lock token, and validates that `leadId` is present. We don't
 * validate field shape here — the backend's Joi validator is the source of
 * truth and will surface a structured error if the agent passes garbage.
 *
 * We DO short-circuit the all-unrouted case: if every key in `args.fields`
 * is unknown to this tenant, the resulting PATCH would be empty and the
 * backend rejects it with `"value" must have at least 1 key`. We turn that
 * into a `ValidationPendingError` listing the real field catalog so the
 * agent re-asks the user *before* the HITL approval card is shown.
 */
export async function preflightUpdateLead(
  args: any,
  ctx: ConnectorContext
): Promise<void> {
  if (!args?.leadId) {
    throw new ValidationPendingError(
      [{ key: "leadId", label: "Lead ID", type: "string" }],
      "leadId is required"
    );
  }
  const c = client(ctx);
  const leadResp = await c.request<any>({
    method: "GET",
    path: `/api/crm/leads/${encodeURIComponent(String(args.leadId))}`,
  });
  if (leadResp.lastModified) ctx.lockToken = leadResp.lastModified;
  // If the agent is updating the phone, normalize before approval so the
  // card preview matches what hits the CRM.
  if (args?.fields && typeof args.fields.phone === "string" && args.fields.phone.length > 0) {
    try {
      args.fields.phone = normalizePhoneToE164(args.fields.phone);
    } catch (e: any) {
      throw new ValidationPendingError(
        [{ key: "phone", label: "Phone (international, e.g. +201012345678)", type: "string" }],
        e?.message ?? "Phone number is not valid"
      );
    }
  }
  // Pre-route to detect the all-unrouted case so we coach BEFORE the user
  // has to approve a card that's destined to fail.
  const fields = (args?.fields ?? {}) as Record<string, any>;
  const submittedKeys = Object.keys(fields);
  if (submittedKeys.length > 0) {
    const schema = await getSchema(ctx.uid, c);
    const routed = routeUpdateFields({ fields, schema });
    const hasAny =
      Object.keys(routed.topLevel).length > 0 ||
      Object.keys(routed.crm).length > 0 ||
      routed.customFields.length > 0;
    if (!hasAny) {
      const known = buildKnownFieldList(schema);
      throw new ValidationPendingError(
        submittedKeys.map((k) => ({
          key: k,
          label: `Unknown field "${k}"`,
          type: "string",
        })),
        `None of (${submittedKeys.join(", ")}) match a real field on this tenant. ` +
        `Valid fields are: ${known}. Ask the user which one they meant.`
      );
    }
  }
}

/**
 * Same role as preflightUpdateLead — capture the lock token and require
 * leadId+assigneeUserId. Lets approved assigns reach the backend's
 * optimistic-lock middleware with `If-Unmodified-Since`.
 */
export async function preflightAssignLead(
  args: any,
  ctx: ConnectorContext
): Promise<void> {
  const missing: Array<{ key: string; label: string; type: string }> = [];
  if (!args?.leadId) missing.push({ key: "leadId", label: "Lead ID", type: "string" });
  if (!args?.assigneeUserId)
    missing.push({ key: "assigneeUserId", label: "Assignee user ID", type: "string" });
  if (missing.length > 0) {
    throw new ValidationPendingError(missing, "leadId and assigneeUserId are required");
  }
  const c = client(ctx);
  // Resolve "me" → real userId BEFORE the approval card is shown so the
  // preview reflects what will actually be sent (an opaque "me" string in
  // the card preview is confusing — show the resolved id).
  try {
    args.assigneeUserId = resolveAssignee(c, args.assigneeUserId);
  } catch (e: any) {
    throw new ValidationPendingError(
      [{ key: "assigneeUserId", label: "Assignee user ID", type: "string" }],
      e?.message ?? "Could not resolve assignee",
    );
  }
  // Defense-in-depth against the agent fabricating an id from a name.
  // After "me"-resolution above, the value MUST look like a Mongo ObjectId
  // (24 hex chars). Anything else (e.g. "Sara Ahmed", "user_abc") is a clear
  // sign the agent skipped crm_list_users — coach it back to the lookup tool
  // so the user isn't asked to approve an assignment to a fabricated id.
  if (!/^[0-9a-fA-F]{24}$/.test(String(args.assigneeUserId))) {
    throw new ValidationPendingError(
      [
        {
          key: "assigneeUserId",
          label: `Assignee user ID (got "${args.assigneeUserId}" — looks like a name, not an id)`,
          type: "string",
        },
      ],
      `assigneeUserId must be a 24-char ObjectId. Call crm_list_users first to resolve "${args.assigneeUserId}" to a real user id, then retry. If multiple users match, ask the user which one via ask_user.`,
    );
  }
  const leadResp = await c.request<any>({
    method: "GET",
    path: `/api/crm/leads/${encodeURIComponent(String(args.leadId))}`,
  });
  if (leadResp.lastModified) ctx.lockToken = leadResp.lastModified;
}

export async function preflightTransitionStage(
  args: any,
  ctx: ConnectorContext
): Promise<void> {
  if (!args?.leadId || !args?.toStageId) {
    throw new ValidationPendingError(
      [
        ...(args?.leadId ? [] : [{ key: "leadId", label: "Lead ID", type: "string" }]),
        ...(args?.toStageId
          ? []
          : [{ key: "toStageId", label: "Target stage", type: "string" }]),
      ],
      "leadId and toStageId are required"
    );
  }
  const c = client(ctx);
  const schema = await getSchema(ctx.uid, c);
  // Defense-in-depth: reject toStageId that doesn't exist in this tenant's
  // pipeline. Without this the backend returns a generic 4xx; with it the
  // agent is told the real stages by name so it can call ask_user (or pick
  // the right one if it just fat-fingered the id).
  const knownStage = schema.stages.find((s) => s._id === String(args.toStageId));
  if (!knownStage) {
    const list = schema.stages
      .map((s) => `"${s.name}" (${s._id})`)
      .join(", ");
    throw new ValidationPendingError(
      [
        {
          key: "toStageId",
          label: `Target stage (got "${args.toStageId}" — not a stage on this pipeline)`,
          type: "string",
        },
      ],
      `toStageId must be a stage id from this tenant's pipeline. Available stages: ${list}. Call crm_list_stages to refresh, or ask_user if the user's request was ambiguous about which stage.`,
    );
  }
  const leadResp = await c.request<any>({
    method: "GET",
    path: `/api/crm/leads/${encodeURIComponent(String(args.leadId))}`,
  });
  const lead = unwrap(leadResp.data);
  const v = validateTransition({
    lead,
    toStageId: args.toStageId,
    fieldUpdates: args.fieldUpdates,
    schema,
  });
  if (!v.ok) {
    throw new ValidationPendingError(v.missing, v.message ?? "Validation failed");
  }
  // Stash the optimistic-lock token so the executor can send If-Unmodified-Since.
  if (leadResp.lastModified) {
    ctx.lockToken = leadResp.lastModified;
  }
}

// ─── User listing / "me" resolution ─────────────────────────────────────────

interface AssignableUser {
  id: string;
  name: string;
  email?: string;
  role?: string;
  isMe?: boolean;
}

function normalizeUser(raw: any): AssignableUser | null {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw._id ?? raw.id ?? raw.userId ?? "").trim();
  if (!id) return null;
  const name =
    String(raw.name ?? "").trim() ||
    [raw.firstName, raw.lastName].filter(Boolean).join(" ").trim() ||
    String(raw.email ?? "").trim() ||
    id;
  const out: AssignableUser = { id, name };
  if (raw.email) out.email = String(raw.email);
  const role = raw.role ?? raw.roleId?.title ?? raw.roleName ?? raw.title;
  if (role) out.role = String(role);
  return out;
}

function unwrapUserList(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.data?.users)) return body.data.users;
  if (Array.isArray(body?.data?.members)) return body.data.members;
  if (Array.isArray(body?.users)) return body.users;
  if (Array.isArray(body?.members)) return body.members;
  return [];
}

export async function handleListUsers(args: any, ctx: ConnectorContext) {
  const c = client(ctx);
  // The CRM FE composes the assignee list from three /api/platform/teams
  // endpoints. We call them in parallel; if any one 4xxs we still return
  // what we got so the agent can at least try.
  const PATHS = [
    "/api/platform/teams/users/managers",
    "/api/platform/teams/users/team-leads",
    "/api/platform/teams/unassigned/members",
  ];
  const results = await Promise.allSettled(
    PATHS.map((p) => c.request<any>({ method: "GET", path: p, query: { limit: 100 } })),
  );
  const seen = new Map<string, AssignableUser>();
  for (const r of results) {
    if (r.status !== "fulfilled") {
      console.warn("[tech_trax_crm.handleListUsers] one source failed:", (r as any).reason?.message ?? r);
      continue;
    }
    for (const raw of unwrapUserList(r.value.data)) {
      const u = normalizeUser(raw);
      if (u && !seen.has(u.id)) seen.set(u.id, u);
    }
  }
  // Mark the connected user.
  const me = c.getIdentity();
  if (me?.userId && seen.has(me.userId)) {
    const cur = seen.get(me.userId)!;
    cur.isMe = true;
  } else if (me?.userId) {
    // Connected user wasn't in any team list (e.g. admin not in a team) —
    // still surface them so "assign to me" works.
    seen.set(me.userId, {
      id: me.userId,
      name: me.email ?? "Me",
      email: me.email,
      role: me.role,
      isMe: true,
    });
  }
  let users = [...seen.values()];
  // Optional client-side search filter.
  const q = String(args?.search ?? "").trim().toLowerCase();
  if (q) {
    users = users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        (u.email ? u.email.toLowerCase().includes(q) : false),
    );
  }
  return { users, me: me?.userId ?? null };
}

/**
 * Resolves a user-id-or-shortcut into a real userId. Supports literal "me"
 * (and a few common aliases) so the agent doesn't have to call crm_list_users
 * just to map the connected user. Anything else is returned untouched and
 * trusted — invalid IDs surface from the backend as a 400.
 */
function resolveAssignee(c: TechTraxClient, raw: unknown): string {
  const v = String(raw ?? "").trim();
  if (!v) throw { code: "invalid_argument", message: "assigneeUserId is required", retryable: false };
  if (/^(me|myself|self|i|current_user|current-user)$/i.test(v)) {
    const me = c.getIdentity();
    if (!me?.userId) {
      throw {
        code: "invalid_argument",
        message:
          "Could not resolve 'me' — the access token didn't carry a userId. Call crm_list_users to see candidates and pass an explicit id.",
        retryable: false,
      };
    }
    return me.userId;
  }
  return v;
}

// ─── Stage management handlers ──────────────────────────────────────────────

const HEX_COLOR = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

function missing(key: string, label: string, type = "string") {
  return { key, label, type };
}

export async function handleCreateStage(args: any, ctx: ConnectorContext) {
  const c = client(ctx);
  const body: Record<string, any> = {
    name: String(args.name).trim(),
    sortOrder: Number(args.sortOrder),
  };
  if (args.color) body.color = String(args.color);
  if (Array.isArray(args.mandatoryFields) && args.mandatoryFields.length > 0) {
    body.mandatoryFields = args.mandatoryFields.map((x: any) => String(x));
  }
  const resp = await requestWithEnumRetry<any>(c, {
    method: "POST",
    path: "/api/crm/stages",
    body,
    idempotencyKey: ctx.idempotencyKey,
  });
  const stage = unwrap(resp.data) as any;
  verify(!!stage?._id, "create stage response had no _id", { actual: stage });
  verify(eqIdLike(stage?.name, body.name), "stage name in response doesn't match", {
    expected: body.name,
    actual: stage?.name,
  });
  await invalidateSchema(ctx.uid);
  return { stage };
}

export async function handleUpdateStage(args: any, ctx: ConnectorContext) {
  const c = client(ctx);
  const body: Record<string, any> = {};
  if (typeof args.name === "string" && args.name.trim()) body.name = args.name.trim();
  if (args.color) body.color = String(args.color);
  if (Array.isArray(args.mandatoryFields)) {
    body.mandatoryFields = args.mandatoryFields.map((x: any) => String(x));
  }
  const resp = await requestWithEnumRetry<any>(c, {
    method: "PATCH",
    path: `/api/crm/stages/${encodeURIComponent(String(args.stageId))}`,
    body,
    idempotencyKey: ctx.idempotencyKey,
  });
  const stage = unwrap(resp.data) as any;
  if (body.name !== undefined) {
    verify(eqIdLike(stage?.name, body.name), "stage name not updated", {
      expected: body.name,
      actual: stage?.name,
    });
  }
  if (body.color !== undefined) {
    verify(eqIdLike(stage?.color, body.color), "stage color not updated", {
      expected: body.color,
      actual: stage?.color,
    });
  }
  if (Array.isArray(body.mandatoryFields)) {
    const got = Array.isArray(stage?.mandatoryFields)
      ? stage.mandatoryFields.map((m: any) => pickId(m)).sort()
      : [];
    const want = [...body.mandatoryFields].map((x) => String(x)).sort();
    verify(
      got.length === want.length && got.every((g: string, i: number) => g === want[i]),
      "mandatoryFields not updated to the requested set",
      { expected: want, actual: got },
    );
  }
  await invalidateSchema(ctx.uid);
  return { stage };
}

export async function handleDeleteStage(args: any, ctx: ConnectorContext) {
  const c = client(ctx);
  const body: Record<string, any> = {};
  if (args.reassignToStageId) body.reassignToStageId = String(args.reassignToStageId);
  const resp = await requestWithEnumRetry<any>(c, {
    method: "DELETE",
    path: `/api/crm/stages/${encodeURIComponent(String(args.stageId))}`,
    body,
    idempotencyKey: ctx.idempotencyKey,
  });
  await invalidateSchema(ctx.uid);
  // Verify by re-fetching the stages list — the deleted id should be gone.
  try {
    const stagesResp = await c.request<any>({ method: "GET", path: "/api/crm/stages" });
    const list = unwrap(stagesResp.data) as any[];
    const stillThere = Array.isArray(list)
      ? list.some((s: any) => eqIdLike(s?._id, args.stageId))
      : false;
    verify(!stillThere, "stage still present after delete", { stageId: args.stageId });
  } catch (e: any) {
    if (e?.code === "verification_failed") throw e;
    // Re-fetch failed — surface as a soft warning but don't block; the
    // delete returned 200 so the backend believed it.
    console.warn("[tech_trax_crm.handleDeleteStage] post-delete verify GET failed:", e?.message);
  }
  return { result: unwrap(resp.data) };
}

// ─── Custom field handlers ──────────────────────────────────────────────────

const CUSTOM_FIELDS_PATH = "/api/platform/custom-fields";

export async function handleListCustomFields(args: any, ctx: ConnectorContext) {
  const c = client(ctx);
  const query: Record<string, string | number | boolean | undefined> = {
    module: "crm",
    limit: 100,
  };
  if (args?.location) query.location = String(args.location);
  if (args?.isActive === undefined || args.isActive === true) {
    query.isActive = "true";
  } else if (args?.isActive === false) {
    query.isActive = "false";
  }
  const resp = await c.request<any>({
    method: "GET",
    path: CUSTOM_FIELDS_PATH,
    query,
  });
  return { customFields: unwrap(resp.data) };
}

export async function handleCreateCustomField(args: any, ctx: ConnectorContext) {
  const c = client(ctx);
  const body: Record<string, any> = {
    fieldName: String(args.fieldName).trim().toLowerCase(),
    label: String(args.label).trim(),
    fieldType: String(args.fieldType),
    location: String(args.location),
    module: args.module ? String(args.module) : "crm",
  };
  if (Array.isArray(args.options) && args.options.length > 0) {
    body.options = args.options.map((x: any) => String(x));
  }
  if (typeof args.isMandatory === "boolean") body.isMandatory = args.isMandatory;
  if (typeof args.requiredAtCreation === "boolean") {
    body.requiredAtCreation = args.requiredAtCreation;
  }
  const resp = await requestWithEnumRetry<any>(c, {
    method: "POST",
    path: CUSTOM_FIELDS_PATH,
    body,
    idempotencyKey: ctx.idempotencyKey,
  });
  const cf = unwrap(resp.data) as any;
  verify(!!cf?._id, "create custom-field response had no _id", { actual: cf });
  verify(eqIdLike(cf?.fieldName, body.fieldName), "fieldName not stored as sent", {
    expected: body.fieldName,
    actual: cf?.fieldName,
  });
  verify(eqIdLike(cf?.fieldType, body.fieldType), "fieldType not stored as sent", {
    expected: body.fieldType,
    actual: cf?.fieldType,
  });
  await invalidateSchema(ctx.uid);
  return { customField: cf };
}

export async function handleUpdateCustomField(args: any, ctx: ConnectorContext) {
  const c = client(ctx);
  const body: Record<string, any> = {};
  if (typeof args.label === "string" && args.label.trim()) body.label = args.label.trim();
  if (Array.isArray(args.options)) body.options = args.options.map((x: any) => String(x));
  if (typeof args.isMandatory === "boolean") body.isMandatory = args.isMandatory;
  if (typeof args.requiredAtCreation === "boolean") {
    body.requiredAtCreation = args.requiredAtCreation;
  }
  if (typeof args.isActive === "boolean") body.isActive = args.isActive;
  const resp = await requestWithEnumRetry<any>(c, {
    method: "PUT",
    path: `${CUSTOM_FIELDS_PATH}/${encodeURIComponent(String(args.fieldId))}`,
    body,
    idempotencyKey: ctx.idempotencyKey,
  });
  const cf = unwrap(resp.data) as any;
  for (const k of ["label", "isMandatory", "requiredAtCreation", "isActive"] as const) {
    if (body[k] !== undefined) {
      verify(eqIdLike(cf?.[k], body[k]), `customField.${k} not updated`, {
        expected: body[k],
        actual: cf?.[k],
      });
    }
  }
  if (Array.isArray(body.options)) {
    const got = Array.isArray(cf?.options) ? [...cf.options].map(String).sort() : [];
    const want = [...body.options].map(String).sort();
    verify(
      got.length === want.length && got.every((g: string, i: number) => g === want[i]),
      "customField.options not updated to the requested set",
      { expected: want, actual: got },
    );
  }
  await invalidateSchema(ctx.uid);
  return { customField: cf };
}

export async function handleDeleteCustomField(args: any, ctx: ConnectorContext) {
  const c = client(ctx);
  const resp = await requestWithEnumRetry<any>(c, {
    method: "DELETE",
    path: `${CUSTOM_FIELDS_PATH}/${encodeURIComponent(String(args.fieldId))}`,
    idempotencyKey: ctx.idempotencyKey,
  });
  await invalidateSchema(ctx.uid);
  return { result: unwrap(resp.data) };
}

// ─── Stage / custom-field preflight ─────────────────────────────────────────

export async function preflightCreateStage(args: any, _ctx: ConnectorContext): Promise<void> {
  const m: Array<{ key: string; label: string; type: string }> = [];
  if (!args?.name || typeof args.name !== "string" || !args.name.trim()) {
    m.push(missing("name", "Stage name"));
  }
  if (args?.sortOrder === undefined || args?.sortOrder === null || Number.isNaN(Number(args.sortOrder))) {
    m.push(missing("sortOrder", "Sort order (integer)", "number"));
  }
  if (args?.color && !HEX_COLOR.test(String(args.color))) {
    m.push(missing("color", "Color (hex like '#3B82F6')"));
  }
  if (m.length > 0) throw new ValidationPendingError(m, "Stage create is missing required fields");
}

export async function preflightUpdateStage(args: any, _ctx: ConnectorContext): Promise<void> {
  if (!args?.stageId) {
    throw new ValidationPendingError([missing("stageId", "Stage ID")], "stageId is required");
  }
  const hasAny =
    (typeof args.name === "string" && args.name.trim()) ||
    args.color ||
    Array.isArray(args.mandatoryFields);
  if (!hasAny) {
    throw new ValidationPendingError(
      [missing("name", "name | color | mandatoryFields")],
      "At least one of name, color, or mandatoryFields is required",
    );
  }
  if (args?.color && !HEX_COLOR.test(String(args.color))) {
    throw new ValidationPendingError(
      [missing("color", "Color (hex like '#3B82F6')")],
      "Color must be a hex string",
    );
  }
}

export async function preflightDeleteStage(args: any, _ctx: ConnectorContext): Promise<void> {
  if (!args?.stageId) {
    throw new ValidationPendingError([missing("stageId", "Stage ID")], "stageId is required");
  }
}

const ALLOWED_FIELD_TYPES = new Set([
  "text",
  "text_area",
  "number",
  "date",
  "single_select",
  "multi_select",
  "boolean",
]);
const ALLOWED_LOCATIONS = new Set(["customer_profile", "appointment", "consultation"]);

export async function preflightCreateCustomField(args: any, _ctx: ConnectorContext): Promise<void> {
  const m: Array<{ key: string; label: string; type: string }> = [];
  if (!args?.fieldName) m.push(missing("fieldName", "Field name (snake_case)"));
  if (!args?.label) m.push(missing("label", "Label"));
  if (!args?.fieldType) m.push(missing("fieldType", "Field type"));
  if (!args?.location) m.push(missing("location", "Location"));
  if (args?.fieldType && !ALLOWED_FIELD_TYPES.has(String(args.fieldType))) {
    m.push(missing("fieldType", `Field type must be one of: ${Array.from(ALLOWED_FIELD_TYPES).join(", ")}`));
  }
  if (args?.location && !ALLOWED_LOCATIONS.has(String(args.location))) {
    m.push(missing("location", `Location must be one of: ${Array.from(ALLOWED_LOCATIONS).join(", ")}`));
  }
  const ft = String(args?.fieldType ?? "");
  if ((ft === "single_select" || ft === "multi_select") &&
      (!Array.isArray(args.options) || args.options.length === 0)) {
    m.push(missing("options", "Options (required for select fields)", "array"));
  }
  if (m.length > 0) {
    throw new ValidationPendingError(m, "Custom field create is missing required fields");
  }
}

export async function preflightUpdateCustomField(args: any, _ctx: ConnectorContext): Promise<void> {
  if (!args?.fieldId) {
    throw new ValidationPendingError([missing("fieldId", "Field ID")], "fieldId is required");
  }
  const hasAny =
    (typeof args.label === "string" && args.label.trim()) ||
    Array.isArray(args.options) ||
    typeof args.isMandatory === "boolean" ||
    typeof args.requiredAtCreation === "boolean" ||
    typeof args.isActive === "boolean";
  if (!hasAny) {
    throw new ValidationPendingError(
      [missing("label", "label | options | isMandatory | requiredAtCreation | isActive")],
      "At least one updatable field is required",
    );
  }
}

export async function preflightDeleteCustomField(args: any, _ctx: ConnectorContext): Promise<void> {
  if (!args?.fieldId) {
    throw new ValidationPendingError([missing("fieldId", "Field ID")], "fieldId is required");
  }
}

// ─── Tool registry ──────────────────────────────────────────────────────────

export const tools: ConnectorTool[] = [
  {
    name: "crm_list_stages",
    class: "read",
    declaration: CRM_LIST_STAGES_DECL,
    handler: handleListStages,
    requiredScopes: [],
  },
  {
    name: "crm_list_leads",
    class: "read",
    declaration: CRM_LIST_LEADS_DECL,
    handler: handleListLeads,
    requiredScopes: [],
  },
  {
    name: "crm_get_lead",
    class: "read",
    declaration: CRM_GET_LEAD_DECL,
    handler: handleGetLead,
    requiredScopes: [],
  },
  {
    name: "crm_create_lead",
    class: "write",
    declaration: CRM_CREATE_LEAD_DECL,
    handler: handleCreateLead,
    requiredScopes: [],
    preflight: preflightCreateLead,
    summarizeForApproval: (args) => {
      const name = `${args?.firstName ?? ""} ${args?.lastName ?? ""}`.trim();
      return `Create lead "${name}" (${args?.phone || args?.email || "no contact"})`;
    },
  },
  {
    name: "crm_update_lead",
    class: "write",
    declaration: CRM_UPDATE_LEAD_DECL,
    handler: handleUpdateLead,
    requiredScopes: [],
    preflight: preflightUpdateLead,
    summarizeForApproval: (args) =>
      `Update lead ${args?.leadId}: set ${Object.keys(args?.fields ?? {}).join(", ") || "(no fields)"}`,
  },
  {
    name: "crm_transition_stage",
    class: "write",
    declaration: CRM_TRANSITION_STAGE_DECL,
    handler: handleTransitionStage,
    requiredScopes: [],
    preflight: preflightTransitionStage,
    summarizeForApproval: (args) => {
      const updates = args?.fieldUpdates && Object.keys(args.fieldUpdates).length > 0
        ? ` with updates: ${Object.keys(args.fieldUpdates).join(", ")}`
        : "";
      return `Move lead ${args?.leadId} to stage ${args?.toStageId}${updates}`;
    },
  },
  {
    name: "crm_list_users",
    class: "read",
    declaration: CRM_LIST_USERS_DECL,
    handler: handleListUsers,
    requiredScopes: [],
  },
  {
    name: "crm_assign_lead",
    class: "write",
    declaration: CRM_ASSIGN_LEAD_DECL,
    handler: handleAssignLead,
    requiredScopes: [],
    preflight: preflightAssignLead,
    summarizeForApproval: (args) =>
      `Assign lead ${args?.leadId} to user ${args?.assigneeUserId}`,
  },
  // ─── Pipeline stage admin ──────────────────────────────────────────
  {
    name: "crm_create_stage",
    class: "write",
    declaration: CRM_CREATE_STAGE_DECL,
    handler: handleCreateStage,
    requiredScopes: [],
    preflight: preflightCreateStage,
    summarizeForApproval: (args) =>
      `Create pipeline stage "${args?.name}" at position ${args?.sortOrder}` +
      (args?.color ? ` (${args.color})` : ""),
  },
  {
    name: "crm_update_stage",
    class: "write",
    declaration: CRM_UPDATE_STAGE_DECL,
    handler: handleUpdateStage,
    requiredScopes: [],
    preflight: preflightUpdateStage,
    summarizeForApproval: (args) => {
      const fields = ["name", "color", "mandatoryFields"]
        .filter((k) => args?.[k] !== undefined)
        .join(", ");
      return `Update stage ${args?.stageId}: ${fields || "(no fields)"}`;
    },
  },
  {
    name: "crm_delete_stage",
    class: "write",
    declaration: CRM_DELETE_STAGE_DECL,
    handler: handleDeleteStage,
    requiredScopes: [],
    preflight: preflightDeleteStage,
    summarizeForApproval: (args) =>
      `Delete pipeline stage ${args?.stageId}` +
      (args?.reassignToStageId ? `; reassign open leads to ${args.reassignToStageId}` : ""),
  },
  // ─── Custom field admin ────────────────────────────────────────────
  {
    name: "crm_list_custom_fields",
    class: "read",
    declaration: CRM_LIST_CUSTOM_FIELDS_DECL,
    handler: handleListCustomFields,
    requiredScopes: [],
  },
  {
    name: "crm_create_custom_field",
    class: "write",
    declaration: CRM_CREATE_CUSTOM_FIELD_DECL,
    handler: handleCreateCustomField,
    requiredScopes: [],
    preflight: preflightCreateCustomField,
    summarizeForApproval: (args) =>
      `Create custom field "${args?.label}" (${args?.fieldType}) at ${args?.location}`,
  },
  {
    name: "crm_update_custom_field",
    class: "write",
    declaration: CRM_UPDATE_CUSTOM_FIELD_DECL,
    handler: handleUpdateCustomField,
    requiredScopes: [],
    preflight: preflightUpdateCustomField,
    summarizeForApproval: (args) => {
      const fields = ["label", "options", "isMandatory", "requiredAtCreation", "isActive"]
        .filter((k) => args?.[k] !== undefined)
        .join(", ");
      return `Update custom field ${args?.fieldId}: ${fields || "(no fields)"}`;
    },
  },
  {
    name: "crm_delete_custom_field",
    class: "write",
    declaration: CRM_DELETE_CUSTOM_FIELD_DECL,
    handler: handleDeleteCustomField,
    requiredScopes: [],
    preflight: preflightDeleteCustomField,
    summarizeForApproval: (args) => `Delete custom field ${args?.fieldId}`,
  },
];
