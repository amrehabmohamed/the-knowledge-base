import { auth } from "./firebase";
import { callFunction } from "./api";
import { CONNECTOR_OAUTH_START_URL } from "@/config/constants";

export interface ConnectorStatus {
  provider: string;
  connected: boolean;
  email?: string;
  scopes?: string[];
  connectedAt?: number;
}

export interface PendingActionEvent {
  actionId: string;
  provider: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  expiresAt: number;
}

export interface ScopeExpansionEvent {
  provider: string;
  tool: string;
  missingScopes: string[];
}

export async function startConnectorOAuth(
  provider: string,
  mode: "initial" | "expand" = "initial"
): Promise<string> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Not authenticated.");

  const url = new URL(CONNECTOR_OAUTH_START_URL);
  url.searchParams.set("provider", provider);
  url.searchParams.set("mode", mode);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to start OAuth (${response.status}).`);
  }

  const data = (await response.json()) as { url?: string };
  if (!data.url) throw new Error("No auth URL returned.");
  return data.url;
}

export async function getConnectorStatus(): Promise<ConnectorStatus[]> {
  const data = await callFunction<{ connectors: ConnectorStatus[] }>(
    "getConnectorStatus"
  );
  return data.connectors ?? [];
}

export async function disconnectConnector(provider: string): Promise<void> {
  await callFunction<{ ok: true }>("disconnectConnector", { provider });
}

export async function confirmPendingAction(
  actionId: string
): Promise<{ result: unknown }> {
  const data = await callFunction<
    { ok: true; result: unknown } | { ok: false; error: string }
  >("confirmPendingAction", { actionId });
  if (!data.ok) {
    throw new Error(data.error ?? "Action failed.");
  }
  return { result: data.result };
}

export async function cancelPendingAction(actionId: string): Promise<void> {
  await callFunction<{ ok: true }>("cancelPendingAction", { actionId });
}
