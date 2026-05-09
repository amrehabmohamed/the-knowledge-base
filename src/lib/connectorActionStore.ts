import { useSyncExternalStore } from "react";

/**
 * In-memory store for the live state of HITL action cards (and scope grants).
 * Survives unmount/remount across the streaming → persisted-message boundary,
 * so a card the user just confirmed stays "Done" when its hosting message
 * re-renders from Firestore. Resets on page reload.
 *
 * Keys are scoped: `action:<actionId>` for pending actions, `scope:<provider>:<tool>`
 * for scope expansions.
 */

export interface ActionRuntimeState {
  state: "pending" | "confirming" | "cancelling" | "executed" | "cancelled" | "expired" | "error";
  result?: unknown;
  error?: string;
}

export interface ScopeRuntimeState {
  state: "pending" | "granting" | "granted" | "error";
  error?: string;
}

const actionMap = new Map<string, ActionRuntimeState>();
const scopeMap = new Map<string, ScopeRuntimeState>();
const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function getActionState(actionId: string): ActionRuntimeState | undefined {
  return actionMap.get(actionId);
}

export function setActionState(actionId: string, patch: Partial<ActionRuntimeState>): void {
  const prev = actionMap.get(actionId) ?? { state: "pending" };
  actionMap.set(actionId, { ...prev, ...patch });
  notify();
}

export function getScopeState(key: string): ScopeRuntimeState | undefined {
  return scopeMap.get(key);
}

export function setScopeState(key: string, patch: Partial<ScopeRuntimeState>): void {
  const prev = scopeMap.get(key) ?? { state: "pending" };
  scopeMap.set(key, { ...prev, ...patch });
  notify();
}

export function useActionState(actionId: string): ActionRuntimeState | undefined {
  return useSyncExternalStore(
    subscribe,
    () => actionMap.get(actionId),
    () => undefined
  );
}

export function useScopeState(key: string): ScopeRuntimeState | undefined {
  return useSyncExternalStore(
    subscribe,
    () => scopeMap.get(key),
    () => undefined
  );
}
