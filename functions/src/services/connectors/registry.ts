import * as crypto from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import type { FunctionDeclaration } from "@google/genai";
import type {
  ConnectorProvider,
  ConnectorTool,
  ConnectorRecord,
  ConnectorContext,
} from "./types";
import { writeAudit } from "./audit";
import { createPendingAction, getPendingAction, markStatus } from "./pendingActions";

const providers = new Map<string, ConnectorProvider>();
const toolIndex = new Map<string, { provider: ConnectorProvider; tool: ConnectorTool }>();

export function register(provider: ConnectorProvider): void {
  for (const tool of provider.tools) {
    if (toolIndex.has(tool.name)) {
      throw new Error(`Tool name '${tool.name}' already registered`);
    }
  }
  providers.set(provider.id, provider);
  for (const tool of provider.tools) {
    toolIndex.set(tool.name, { provider, tool });
  }
}

export function getProvider(id: string): ConnectorProvider | undefined {
  return providers.get(id);
}

export function getAllProviders(): ConnectorProvider[] {
  return Array.from(providers.values());
}

/** For tests only. */
export function _resetRegistry(): void {
  providers.clear();
  toolIndex.clear();
}

async function getConnectedRecords(uid: string): Promise<Map<string, ConnectorRecord>> {
  const db = getFirestore();
  const snap = await db.collection("users").doc(uid).collection("connectors").get();
  const out = new Map<string, ConnectorRecord>();
  snap.forEach((d) => {
    const r = d.data() as ConnectorRecord;
    if (r.status === "connected") out.set(d.id, r);
  });
  return out;
}

export async function getEnabledTools(uid: string): Promise<ConnectorTool[]> {
  const records = await getConnectedRecords(uid);
  const tools: ConnectorTool[] = [];
  for (const provider of providers.values()) {
    if (records.has(provider.id)) tools.push(...provider.tools);
  }
  return tools;
}

export async function getEnabledDeclarations(uid: string): Promise<FunctionDeclaration[]> {
  const tools = await getEnabledTools(uid);
  return tools.map((t) => t.declaration);
}

function canonicalStringify(v: any): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(v[k])}`).join(",")}}`;
}

function makeIdempotencyKey(parts: { uid: string; sessionId?: string; tool: string; args: any }): string {
  const h = crypto.createHash("sha256");
  h.update(canonicalStringify({ uid: parts.uid, sessionId: parts.sessionId ?? "", tool: parts.tool, args: parts.args }));
  return h.digest("hex");
}

function normalizeError(err: unknown): { code: string; message: string; retryable: boolean } {
  const e: any = err;
  const code = e?.code || e?.name || "INTERNAL";
  const message = e?.message || String(err);
  const retryable = !!e?.retryable || /timeout|temporar|unavailable|ECONN|ETIMEDOUT/i.test(message);
  return { code: String(code), message, retryable };
}

export type DispatchResult =
  | { kind: "result"; data: unknown }
  | { kind: "awaiting_approval"; actionId: string; summary: string; provider: string }
  | { kind: "scope_required"; provider: string; tool: string; missingScopes: string[] };

export async function dispatch(
  toolName: string,
  args: any,
  ctx: { uid: string; sessionId?: string }
): Promise<DispatchResult> {
  const entry = toolIndex.get(toolName);
  if (!entry) throw new Error(`Unknown tool '${toolName}'`);
  const { provider, tool } = entry;

  const records = await getConnectedRecords(ctx.uid);
  const rec = records.get(provider.id);
  if (!rec) throw new Error(`Connector '${provider.id}' is not connected`);

  const missingScopes = tool.requiredScopes.filter((s) => !rec.scopes.includes(s));
  if (missingScopes.length > 0) {
    return {
      kind: "scope_required",
      provider: provider.id,
      tool: tool.name,
      missingScopes,
    };
  }

  const idempotencyKey = makeIdempotencyKey({
    uid: ctx.uid,
    sessionId: ctx.sessionId,
    tool: tool.name,
    args,
  });

  if (tool.class === "read") {
    const start = Date.now();
    try {
      const oauth = await provider.buildAuthClient(ctx.uid);
      const connectorCtx: ConnectorContext = {
        uid: ctx.uid,
        oauth,
        provider: provider.id,
        sessionId: ctx.sessionId,
        idempotencyKey,
      };
      const data = await tool.handler(args, connectorCtx);
      await writeAudit({
        uid: ctx.uid,
        sessionId: ctx.sessionId,
        provider: provider.id,
        tool: tool.name,
        args,
        result: data,
        status: "ok",
        idempotencyKey,
        latencyMs: Date.now() - start,
      });
      return { kind: "result", data };
    } catch (err) {
      const norm = normalizeError(err);
      await writeAudit({
        uid: ctx.uid,
        sessionId: ctx.sessionId,
        provider: provider.id,
        tool: tool.name,
        args,
        status: "error",
        idempotencyKey,
        latencyMs: Date.now() - start,
        reasonCode: norm.code,
      });
      throw norm;
    }
  }

  // write
  const start = Date.now();
  try {
    const summary = tool.summarizeForApproval?.(args) ?? tool.name;
    const { actionId } = await createPendingAction({
      uid: ctx.uid,
      sessionId: ctx.sessionId ?? "",
      provider: provider.id,
      tool: tool.name,
      args,
      summary,
      idempotencyKey,
    });
    await writeAudit({
      uid: ctx.uid,
      sessionId: ctx.sessionId,
      provider: provider.id,
      tool: tool.name,
      args,
      status: "awaiting_approval",
      idempotencyKey,
      latencyMs: Date.now() - start,
    });
    return { kind: "awaiting_approval", actionId, summary, provider: provider.id };
  } catch (err) {
    const norm = normalizeError(err);
    await writeAudit({
      uid: ctx.uid,
      sessionId: ctx.sessionId,
      provider: provider.id,
      tool: tool.name,
      args,
      status: "error",
      idempotencyKey,
      latencyMs: Date.now() - start,
      reasonCode: norm.code,
    });
    throw norm;
  }
}

export async function executeApprovedAction(actionId: string, uid: string): Promise<unknown> {
  const action = await getPendingAction(actionId);
  if (!action) throw new Error("Pending action not found");
  if (action.uid !== uid) throw new Error("Pending action does not belong to user");
  if (action.status !== "awaiting_approval") {
    throw new Error(`Pending action is in status '${action.status}'`);
  }
  const expiresAtMs = action.expiresAt.toMillis();
  if (expiresAtMs < Date.now()) {
    await markStatus(actionId, "expired");
    throw new Error("Pending action expired");
  }

  const entry = toolIndex.get(action.tool);
  if (!entry) throw new Error(`Unknown tool '${action.tool}'`);
  const { provider, tool } = entry;

  const start = Date.now();
  try {
    const oauth = await provider.buildAuthClient(uid);
    const connectorCtx: ConnectorContext = {
      uid,
      oauth,
      provider: provider.id,
      sessionId: action.sessionId,
      idempotencyKey: action.idempotencyKey,
    };
    const data = await tool.handler(action.args, connectorCtx);
    await markStatus(actionId, "executed", { result: data });
    await writeAudit({
      uid,
      sessionId: action.sessionId,
      provider: provider.id,
      tool: tool.name,
      args: action.args,
      result: data,
      status: "ok",
      idempotencyKey: action.idempotencyKey,
      latencyMs: Date.now() - start,
    });
    return data;
  } catch (err) {
    const norm = normalizeError(err);
    await markStatus(actionId, "error", { error: norm.message });
    await writeAudit({
      uid,
      sessionId: action.sessionId,
      provider: provider.id,
      tool: tool.name,
      args: action.args,
      status: "error",
      idempotencyKey: action.idempotencyKey,
      latencyMs: Date.now() - start,
      reasonCode: norm.code,
    });
    throw norm;
  }
}
