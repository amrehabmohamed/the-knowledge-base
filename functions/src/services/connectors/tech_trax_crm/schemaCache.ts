import * as admin from "firebase-admin";
import type { TechTraxClient } from "./client";

/**
 * A mandatory custom field for a stage. Normalized from the backend's
 * populated shape `{_id, fieldName, fieldType, label}` (see
 * techtrax-backend/src/modules/crm/repositories/stage.repository.js
 * `populate('mandatoryFields', 'fieldName label fieldType')`).
 */
export interface MandatoryField {
  fieldId: string; // the CustomField ObjectId — required when posting customFields[]
  key: string;     // human-readable name (== backend `fieldName`)
  label: string;
  type: string;
}

export interface TechTraxStage {
  _id: string;
  name: string;
  slug: string;
  stageType: string;
  sortOrder: number;
  color?: string;
  mandatoryFields?: MandatoryField[];
  allowedNextStages?: string[];
  slaHours?: number;
}

/** Compact descriptor for any custom field defined on the tenant. */
export interface CustomFieldInfo {
  fieldId: string;
  fieldName: string;
  label: string;
  fieldType: string;
  /** 'customer_profile' | 'appointment' | 'consultation' */
  location?: string;
}

export interface TechTraxSchema {
  stages: TechTraxStage[];
  /**
   * Map of fieldName → fieldId for EVERY active custom field on the tenant
   * (not just mandatory-for-stage ones). Drives `routeUpdateFields`. Falls
   * back to the mandatory-only set if the custom-fields endpoint is
   * unreachable.
   */
  customFieldNameToId: Record<string, string>;
  /** Full list of active custom fields, used for coaching messages. */
  customFields: CustomFieldInfo[];
  fetchedAt: number;
}

const TTL_MS = 60 * 60 * 1000; // 1 hour
// v2 bump (2026-05-09): schema now carries `customFields[]` and a fully
// populated `customFieldNameToId` (not just mandatory-from-stage). Old v1
// docs are missing both — bumping the path forces a fresh fetch instead of
// returning a stale-shaped doc.
const CACHE_PATH = (uid: string) =>
  `users/${uid}/connectors/tech_trax_crm/_schema/v2`;

/**
 * Force the next `getSchema(uid, ...)` call to re-fetch from the backend.
 * Use after stage/custom-field mutations so subsequent tool calls don't see
 * a stale snapshot of the pipeline.
 */
export async function invalidateSchema(uid: string): Promise<void> {
  const db = admin.firestore();
  const ref = db.doc(CACHE_PATH(uid));
  try {
    await ref.delete();
  } catch {
    // best-effort
  }
}

function normalizeMandatoryField(raw: any): MandatoryField | null {
  if (!raw || typeof raw !== "object") return null;
  const fieldId = String(raw._id ?? raw.fieldId ?? "").trim();
  if (!fieldId) return null;
  const key = String(raw.fieldName ?? raw.key ?? raw.name ?? "").trim();
  if (!key) return null;
  return {
    fieldId,
    key,
    label: String(raw.label ?? key),
    type: String(raw.fieldType ?? raw.type ?? "string"),
  };
}

function normalizeStage(raw: any): TechTraxStage | null {
  if (!raw || typeof raw !== "object") return null;
  const _id = String(raw._id ?? raw.id ?? "").trim();
  if (!_id) return null;
  const mandatoryFields = Array.isArray(raw.mandatoryFields)
    ? (raw.mandatoryFields
        .map(normalizeMandatoryField)
        .filter(Boolean) as MandatoryField[])
    : [];
  // Build the stage incrementally — never emit `undefined` field values, since
  // Firestore rejects them inside arrays (path: stages.0.allowedNextStages).
  const stage: TechTraxStage = {
    _id,
    name: String(raw.name ?? ""),
    slug: String(raw.slug ?? ""),
    stageType: String(raw.stageType ?? ""),
    sortOrder: Number(raw.sortOrder ?? 0),
    mandatoryFields,
  };
  if (Array.isArray(raw.allowedNextStages)) {
    stage.allowedNextStages = raw.allowedNextStages.map((x: any) =>
      String(x?._id ?? x)
    );
  }
  if (raw.color) {
    stage.color = String(raw.color);
  }
  if (typeof raw.slaHours === "number") {
    stage.slaHours = raw.slaHours;
  }
  return stage;
}

export async function getSchema(
  uid: string,
  client: TechTraxClient
): Promise<TechTraxSchema> {
  const db = admin.firestore();
  const ref = db.doc(CACHE_PATH(uid));
  const snap = await ref.get();
  if (snap.exists) {
    const cached = snap.data() as TechTraxSchema | undefined;
    if (cached && typeof cached.fetchedAt === "number" && Date.now() - cached.fetchedAt < TTL_MS) {
      return cached;
    }
  }
  const resp = await client.request<any>({ method: "GET", path: "/api/crm/stages" });
  const raw = resp.data;
  const rawStages: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw?.stages)
        ? raw.stages
        : [];
  const stages: TechTraxStage[] = rawStages
    .map(normalizeStage)
    .filter(Boolean) as TechTraxStage[];
  const customFieldNameToId: Record<string, string> = {};
  // Seed with mandatory-from-stage fields (always present in stages payload).
  for (const s of stages) {
    for (const f of s.mandatoryFields ?? []) {
      customFieldNameToId[f.key] = f.fieldId;
    }
  }
  // Fetch the full custom-field catalog so non-mandatory custom fields are
  // also routable. If this fails (network, perms) we still have the
  // mandatory-only map — degraded but functional.
  let customFields: CustomFieldInfo[] = [];
  try {
    const cfResp = await client.request<any>({
      method: "GET",
      path: "/api/platform/custom-fields",
      query: { module: "crm", isActive: "true", limit: 100 },
    });
    const rawList: any[] = Array.isArray(cfResp.data)
      ? cfResp.data
      : Array.isArray(cfResp.data?.data)
        ? cfResp.data.data
        : Array.isArray(cfResp.data?.customFields)
          ? cfResp.data.customFields
          : [];
    for (const f of rawList) {
      if (!f || typeof f !== "object") continue;
      const fieldId = String(f._id ?? f.id ?? "").trim();
      const fieldName = String(f.fieldName ?? f.key ?? f.name ?? "").trim();
      if (!fieldId || !fieldName) continue;
      customFieldNameToId[fieldName] = fieldId;
      const info: CustomFieldInfo = {
        fieldId,
        fieldName,
        label: String(f.label ?? fieldName),
        fieldType: String(f.fieldType ?? "string"),
      };
      if (f.location) info.location = String(f.location);
      customFields.push(info);
    }
  } catch (e) {
    console.warn(
      "[tech_trax_crm.schemaCache] Failed to fetch /api/platform/custom-fields; " +
      "routing falls back to mandatory-from-stages only.",
      e
    );
  }
  const schema: TechTraxSchema = {
    stages,
    customFieldNameToId,
    customFields,
    fetchedAt: Date.now(),
  };
  await ref.set(schema);
  return schema;
}
