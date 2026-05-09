import { getFirestore, Timestamp } from "firebase-admin/firestore";
import type { PendingAction } from "./types";

const DEFAULT_TTL_SEC = 5 * 60;

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as unknown as T;
  // Only recurse into plain objects; preserve class instances like Firestore
  // Timestamp, DocumentReference, GeoPoint, FieldValue sentinels, etc.
  if (value && typeof value === "object" && (value as object).constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

export interface CreatePendingActionInput {
  uid: string;
  sessionId: string;
  provider: string;
  tool: string;
  args: any;
  summary: string;
  idempotencyKey: string;
  ttlSec?: number;
}

export async function createPendingAction(input: CreatePendingActionInput): Promise<{ actionId: string }> {
  const db = getFirestore();
  const now = Date.now();
  const ttlSec = input.ttlSec ?? DEFAULT_TTL_SEC;
  const doc: PendingAction = {
    uid: input.uid,
    sessionId: input.sessionId,
    provider: input.provider,
    tool: input.tool,
    args: input.args,
    summary: input.summary,
    idempotencyKey: input.idempotencyKey,
    status: "awaiting_approval",
    createdAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(now + ttlSec * 1000),
  };
  const ref = await db.collection("pendingActions").add(stripUndefined(doc));
  return { actionId: ref.id };
}

export async function getPendingAction(actionId: string): Promise<PendingAction | null> {
  const db = getFirestore();
  const snap = await db.collection("pendingActions").doc(actionId).get();
  if (!snap.exists) return null;
  return snap.data() as PendingAction;
}

export async function markStatus(
  actionId: string,
  status: PendingAction["status"],
  patch?: { result?: unknown; error?: string }
): Promise<void> {
  const db = getFirestore();
  const update: Record<string, unknown> = { status };
  if (patch?.result !== undefined) update.result = stripUndefined(patch.result);
  if (patch?.error !== undefined) update.error = patch.error;
  await db.collection("pendingActions").doc(actionId).update(update);
}
