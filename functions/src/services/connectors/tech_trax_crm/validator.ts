import type { TechTraxSchema, TechTraxStage } from "./schemaCache";

export interface ValidationResult {
  ok: boolean;
  missing: Array<{ key: string; label: string; type: string }>;
  reason?: "mandatoryFields" | "allowedNextStages" | "joi";
  message?: string;
}

/**
 * Top-level fields accepted directly on the lead doc (createLeadSchema and
 * updateLeadSchema both allow these at the root). Source:
 * techtrax-backend/src/modules/crm/utils/validators.js.
 */
const TOP_LEVEL_LEAD_FIELDS = new Set<string>([
  "firstName",
  "lastName",
  "email",
  "phone",
  "gender",
  "DOB",
  "nationality",
  "address",
  "source",
]);

/**
 * Fields that live under the `crm: { ... }` subdoc on UPDATE only. On CREATE
 * (createLeadSchema) some of these are accepted at the top level (priority,
 * preferredBookingType, preferredDoctor, assignedTo); the create handler keeps
 * them top-level. On UPDATE they MUST be wrapped in the `crm` envelope or
 * Joi's `unknown(false)` rejects them.
 */
const CRM_SUBDOC_FIELDS = new Set<string>([
  "assignedTo",
  "priority",
  "preferredBookingType",
  "preferredDoctor",
  "lastCallOutcome",
  "followUpCount",
  "bookingDate",
  "customerInterestId",
  "snoozeDate",
  "nonBuyingReasonId",
  "nonBuyingReasonComment",
]);

/** Aliases the agent commonly produces → canonical backend keys. */
const KEY_ALIASES: Record<string, string> = {
  assignedToUserId: "assignedTo",
  dob: "DOB",
  birthDate: "DOB",
};

function findStage(schema: TechTraxSchema, stageId: string): TechTraxStage | undefined {
  return schema.stages.find((s) => s._id === stageId);
}

function nonEmpty(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

function getLeadFieldValue(lead: any, key: string, fieldId?: string): unknown {
  if (lead == null || typeof lead !== "object") return undefined;
  if (nonEmpty(lead[key])) return lead[key];
  if (lead.crm && typeof lead.crm === "object" && nonEmpty(lead.crm[key])) {
    return lead.crm[key];
  }
  if (Array.isArray(lead.customFields)) {
    const hit = lead.customFields.find((f: any) => {
      if (!f) return false;
      const fid = String(f.fieldId ?? f._id ?? "");
      // Primary match on fieldId (canonical), fallback on the human key for
      // older or denormalized records.
      if (fieldId && fid && fid === fieldId) return true;
      return f.key === key || f.fieldName === key || f.name === key;
    });
    if (hit && nonEmpty(hit.value)) return hit.value;
  }
  return undefined;
}

function isFieldSatisfied(
  lead: any,
  fieldUpdates: Record<string, any> | undefined,
  key: string,
  fieldId?: string
): boolean {
  if (fieldUpdates && Object.prototype.hasOwnProperty.call(fieldUpdates, key)) {
    if (nonEmpty(fieldUpdates[key])) return true;
  }
  return getLeadFieldValue(lead, key, fieldId) !== undefined;
}

export function validateTransition(args: {
  lead: any;
  toStageId: string;
  fieldUpdates?: Record<string, any>;
  schema: TechTraxSchema;
}): ValidationResult {
  const { lead, toStageId, fieldUpdates, schema } = args;
  const targetStage = findStage(schema, toStageId);
  if (!targetStage) {
    return {
      ok: false,
      missing: [{ key: "toStageId", label: "Target stage", type: "string" }],
      reason: "joi",
      message: "Target stage not found",
    };
  }

  const currentStageId: string | undefined = lead?.crm?.stageId;
  const currentStage = currentStageId ? findStage(schema, currentStageId) : undefined;
  if (
    currentStage &&
    Array.isArray(currentStage.allowedNextStages) &&
    currentStage.allowedNextStages.length > 0 &&
    !currentStage.allowedNextStages.includes(toStageId)
  ) {
    const allowedNames = currentStage.allowedNextStages
      .map((id) => findStage(schema, id)?.name ?? id)
      .join(", ");
    return {
      ok: false,
      missing: [],
      reason: "allowedNextStages",
      message:
        `Cannot transition from ${currentStage.name} to ${targetStage.name}; ` +
        `allowed next stages: ${allowedNames}`,
    };
  }

  const mandatory = Array.isArray(targetStage.mandatoryFields)
    ? targetStage.mandatoryFields
    : [];
  const missing: Array<{ key: string; label: string; type: string }> = [];
  for (const m of mandatory) {
    if (!m || typeof m !== "object") continue;
    const key = m.key;
    if (!key || typeof key !== "string") continue;
    if (!isFieldSatisfied(lead, fieldUpdates, key, m.fieldId)) {
      missing.push({
        key,
        label: m.label ?? key,
        type: m.type ?? "string",
      });
    }
  }
  if (missing.length > 0) {
    const labels = missing.map((m) => m.label).join(", ");
    return {
      ok: false,
      missing,
      reason: "mandatoryFields",
      message: `Stage ${targetStage.name} requires: ${labels}`,
    };
  }
  return { ok: true, missing: [] };
}

export function validateCreate(args: any): ValidationResult {
  const missing: Array<{ key: string; label: string; type: string }> = [];
  const has = (k: string) => {
    const v = args?.[k];
    return v !== undefined && v !== null && String(v).trim() !== "";
  };
  if (!has("firstName")) {
    missing.push({ key: "firstName", label: "First name", type: "string" });
  }
  if (!has("lastName")) {
    missing.push({ key: "lastName", label: "Last name", type: "string" });
  }
  // The Tech Trax createLeadSchema requires BOTH phone and email (validators.js
  // lines 26–36). Surface this strictly so the agent asks the user, not the
  // backend after a 400.
  if (!has("phone")) {
    missing.push({
      key: "phone",
      label: "Phone (international format, e.g. +201012345678)",
      type: "string",
    });
  }
  if (!has("email")) {
    missing.push({ key: "email", label: "Email", type: "string" });
  }
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      reason: "joi",
      message:
        "Cannot create lead — firstName, lastName, phone, and email are all required.",
    };
  }
  return { ok: true, missing: [] };
}

function canonicalKey(k: string): string {
  return KEY_ALIASES[k] ?? k;
}

export interface RoutedUpdateBody {
  /** Fields that go at the root of the PATCH body. */
  topLevel: Record<string, any>;
  /** Fields that must be wrapped under `crm: {...}`. */
  crm: Record<string, any>;
  /** customFields[] entries shaped as the backend expects: `{fieldId, value}`. */
  customFields: Array<{ fieldId: string; value: any }>;
  /** Field names we couldn't route — present for caller diagnostics. */
  unrouted: string[];
}

/**
 * Route a flat agent-supplied `fields` object into the three buckets the Tech
 * Trax updateLeadSchema accepts. Custom fields are mapped from human name to
 * fieldId via the schema cache; unknown names fall into `unrouted` and are
 * dropped (the handler logs them so we can refine the schema cache later).
 */
export function routeUpdateFields(args: {
  fields: Record<string, any>;
  schema: TechTraxSchema;
}): RoutedUpdateBody {
  const topLevel: Record<string, any> = {};
  const crm: Record<string, any> = {};
  const customFields: Array<{ fieldId: string; value: any }> = [];
  const unrouted: string[] = [];
  for (const [rawKey, v] of Object.entries(args.fields ?? {})) {
    const k = canonicalKey(rawKey);
    if (TOP_LEVEL_LEAD_FIELDS.has(k)) {
      topLevel[k] = v;
    } else if (CRM_SUBDOC_FIELDS.has(k)) {
      crm[k] = v;
    } else {
      const fieldId = args.schema.customFieldNameToId[k];
      if (fieldId) {
        customFields.push({ fieldId, value: v });
      } else {
        unrouted.push(rawKey);
      }
    }
  }
  return { topLevel, crm, customFields, unrouted };
}

/**
 * Route fields into the buckets accepted by createLeadSchema. Create accepts
 * priority/assignedTo/preferredBookingType/preferredDoctor at the TOP LEVEL
 * (unlike update, where they're under `crm`).
 */
export function routeCreateFields(args: {
  fields: Record<string, any>;
  schema: TechTraxSchema;
}): {
  topLevel: Record<string, any>;
  customFields: Array<{ fieldId: string; value: any }>;
  unrouted: string[];
} {
  const CREATE_TOP_LEVEL = new Set<string>([
    ...TOP_LEVEL_LEAD_FIELDS,
    "priority",
    "assignedTo",
    "preferredBookingType",
    "preferredDoctor",
  ]);
  const topLevel: Record<string, any> = {};
  const customFields: Array<{ fieldId: string; value: any }> = [];
  const unrouted: string[] = [];
  for (const [rawKey, v] of Object.entries(args.fields ?? {})) {
    const k = canonicalKey(rawKey);
    if (CREATE_TOP_LEVEL.has(k)) {
      topLevel[k] = v;
    } else {
      const fieldId = args.schema.customFieldNameToId[k];
      if (fieldId) {
        customFields.push({ fieldId, value: v });
      } else {
        unrouted.push(rawKey);
      }
    }
  }
  return { topLevel, customFields, unrouted };
}

