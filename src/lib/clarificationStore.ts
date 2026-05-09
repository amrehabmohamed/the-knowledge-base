import { useSyncExternalStore } from "react";

/**
 * In-memory store for the live state of clarification cards. Mirrors
 * `connectorActionStore` — same useSyncExternalStore shape so a card the user
 * just answered stays "answered" when its hosting message re-renders from
 * Firestore. Resets on page reload.
 *
 * Resolution is one-way: pending → answered (or dismissed). There is no
 * server-side persistence for the answers; once the user submits, the answers
 * are folded into a follow-up user message and the card collapses.
 */

export interface ClarificationRuntimeState {
  state: "pending" | "answered" | "dismissed";
  /** The answers map, keyed by question.key. Only set when state === "answered". */
  answers?: Record<string, string>;
}

const map = new Map<string, ClarificationRuntimeState>();
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

export function getClarificationState(
  clarificationId: string,
): ClarificationRuntimeState | undefined {
  return map.get(clarificationId);
}

export function setClarificationState(
  clarificationId: string,
  patch: Partial<ClarificationRuntimeState>,
): void {
  const prev = map.get(clarificationId) ?? { state: "pending" };
  map.set(clarificationId, { ...prev, ...patch });
  notify();
}

export function useClarificationState(
  clarificationId: string,
): ClarificationRuntimeState | undefined {
  return useSyncExternalStore(
    subscribe,
    () => map.get(clarificationId),
    () => undefined,
  );
}
