import { getFirestore, Timestamp } from "firebase-admin/firestore";
import type { AuditLog } from "./types";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefined(v)) as unknown as T;
  }
  // Only recurse into plain objects; preserve class instances (Timestamp, etc.)
  if (value && typeof value === "object" && (value as object).constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

export async function writeAudit(entry: Omit<AuditLog, "createdAt" | "ttlAt">): Promise<void> {
  const db = getFirestore();
  const now = Date.now();
  const doc = stripUndefined({
    ...entry,
    createdAt: Timestamp.fromMillis(now),
    ttlAt: Timestamp.fromMillis(now + NINETY_DAYS_MS),
  }) as AuditLog;
  await db.collection("auditLogs").add(doc);
}
