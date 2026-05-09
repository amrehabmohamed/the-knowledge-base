import { useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  ChevronDown,
  ShieldAlert,
  Loader2,
  Check,
  X,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  cancelPendingAction,
  confirmPendingAction,
  getPendingActionStatus,
  type PendingActionEvent,
} from "@/lib/connectors";
import {
  getActionState,
  isActionResolved,
  setActionState,
  useActionState,
  useActionStoreTick,
} from "@/lib/connectorActionStore";

type State =
  | "pending"
  | "confirming"
  | "cancelling"
  | "executed"
  | "cancelled"
  | "expired"
  | "error";

interface ActionApprovalCardProps {
  action: PendingActionEvent;
  onConfirmed?: (result: unknown) => void;
  onCancelled?: () => void;
}

const TOOL_META: Record<
  string,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  gcal_create_event: { label: "Create calendar event", icon: Calendar },
  gcal_update_event: { label: "Update calendar event", icon: Calendar },
  gcal_delete_event: { label: "Delete calendar event", icon: Calendar },
  gcal_respond_to_event: { label: "RSVP to calendar event", icon: Calendar },
};

function truncate(s: string, max = 200): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

function stringifyResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "Expired";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s left`;
  return `${s}s left`;
}

function StatusIcon({ state }: { state: State }) {
  if (state === "confirming" || state === "cancelling") {
    return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
  }
  if (state === "executed") return <Check className="h-3 w-3 text-green-600" />;
  if (state === "error") return <X className="h-3 w-3 text-red-500" />;
  if (state === "cancelled" || state === "expired") {
    return <X className="h-3 w-3 text-muted-foreground" />;
  }
  return <Clock className="h-3 w-3 text-amber-700 dark:text-amber-400" />;
}

export function ActionApprovalCard({
  action,
  onConfirmed,
  onCancelled,
}: ActionApprovalCardProps) {
  const meta = TOOL_META[action.tool] ?? {
    label: "Action requires your approval",
    icon: ShieldAlert,
  };
  const Icon = meta.icon;

  const runtime = useActionState(action.actionId);
  // Runtime state is the source of truth (set when user clicks Confirm/Cancel,
  // or when the timer fires). If absent, we fall back to the action's own
  // lifecycle: pending if still in window, expired otherwise. NEVER fake an
  // "executed" state — that would make the UI lie about an action the user
  // didn't approve.
  const state: State =
    runtime?.state ?? (Date.now() >= action.expiresAt ? "expired" : "pending");
  const error = runtime?.error ?? null;
  const result = runtime?.result ?? null;
  const [open, setOpen] = useState<boolean>(state === "pending");
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const tickRef = useRef<number | null>(null);

  // Auto-expand when transitioning into pending; collapse on resolve.
  useEffect(() => {
    if (state === "pending") setOpen(true);
    else setOpen(false);
  }, [state]);

  // Hydrate runtime state from backend on mount when the in-memory store is
  // empty (typical after a page refresh). Without this, a card the user
  // already confirmed yesterday would render as if it's still pending.
  // We only fetch once per actionId per page load, and only if no other
  // instance of this card has already populated the store.
  useEffect(() => {
    if (getActionState(action.actionId)) return; // already hydrated
    let cancelled = false;
    (async () => {
      try {
        const persisted = await getPendingActionStatus(action.actionId);
        if (cancelled || getActionState(action.actionId)) return;
        const map: Record<string, State> = {
          awaiting_approval: "pending",
          executed: "executed",
          cancelled: "cancelled",
          expired: "expired",
          error: "error",
          approved: "confirming", // legacy intermediate, treat as in-flight
        };
        const next = map[persisted.status] ?? "pending";
        // Don't write a "pending" entry — we want to leave runtime undefined
        // for live cards so the local-lifecycle fallback (pending vs expired)
        // keeps working without an extra render.
        if (next === "pending") return;
        setActionState(action.actionId, {
          state: next,
          result: persisted.result ?? undefined,
          error: persisted.error ?? undefined,
        });
      } catch {
        // Silent fail — leaving runtime empty falls back to local lifecycle.
        // The most common silent path is `not-found` for a doc never created
        // (shouldn't happen in practice) or auth not yet ready.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [action.actionId]);

  useEffect(() => {
    if (state !== "pending") return;
    tickRef.current = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= action.expiresAt) {
        setActionState(action.actionId, { state: "expired" });
        if (tickRef.current !== null) window.clearInterval(tickRef.current);
      }
    }, 1000);
    return () => {
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
    };
  }, [state, action.actionId, action.expiresAt]);

  const remainingMs = action.expiresAt - now;
  const argsPretty = useMemo(() => {
    try {
      return JSON.stringify(action.args, null, 2);
    } catch {
      return String(action.args);
    }
  }, [action.args]);

  const handleConfirm = async () => {
    setActionState(action.actionId, { state: "confirming", error: undefined });
    try {
      const { result: r } = await confirmPendingAction(action.actionId);
      setActionState(action.actionId, { state: "executed", result: r });
      onConfirmed?.(r);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Action failed.";
      setActionState(action.actionId, { state: "error", error: msg });
    }
  };

  const handleCancel = async () => {
    setConfirmCancelOpen(false);
    setActionState(action.actionId, { state: "cancelling", error: undefined });
    try {
      await cancelPendingAction(action.actionId);
      setActionState(action.actionId, { state: "cancelled" });
      onCancelled?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Cancel failed.";
      setActionState(action.actionId, { state: "error", error: msg });
    }
  };

  const isPending = state === "pending";
  const buttonsDisabled = !isPending;

  // Collapsed-when-resolved layout matches ToolCallCard. Pending stays expanded
  // so the user can act on it.
  const headerClass =
    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left " +
    (isPending ? "cursor-default" : "hover:bg-muted/60 cursor-pointer");

  const stateLabel: Record<State, string> = {
    pending: meta.label,
    confirming: meta.label,
    cancelling: meta.label,
    executed: `${meta.label} — done`,
    cancelled: `${meta.label} — cancelled`,
    expired: `${meta.label} — expired`,
    error: `${meta.label} — error`,
  };

  return (
    <div
      className={
        "rounded-md border text-xs " +
        (isPending
          ? "border-amber-300/60 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5"
          : "border-border/60 bg-muted/30")
      }
    >
      <button
        type="button"
        onClick={() => !isPending && setOpen((o) => !o)}
        className={headerClass}
        disabled={isPending}
      >
        <Icon
          className={
            "h-3.5 w-3.5 shrink-0 " +
            (isPending
              ? "text-amber-700 dark:text-amber-400"
              : "text-muted-foreground")
          }
        />
        <span className="font-medium text-foreground">{stateLabel[state]}</span>
        {!isPending && (
          <span className="truncate text-muted-foreground">
            — {action.summary}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {isPending && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
              <Clock className="h-2.5 w-2.5" />
              {formatRemaining(remainingMs)}
            </span>
          )}
          <StatusIcon state={state} />
          {!isPending && (
            <ChevronDown
              className={
                "h-3 w-3 text-muted-foreground transition-transform " +
                (open ? "rotate-180" : "")
              }
            />
          )}
        </span>
      </button>

      {open && (
        <div
          className={
            "border-t border-border/60 px-3 py-2 space-y-1.5 " +
            (isPending ? "" : "bg-background/40")
          }
        >
          {isPending && (
            <p className="font-body text-xs text-foreground/80">
              {action.summary}
            </p>
          )}

          <details className="group">
            <summary className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground select-none">
              <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
              Args
            </summary>
            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-[11px] leading-snug text-muted-foreground">
              {argsPretty}
            </pre>
          </details>

          {state === "executed" && (
            <p className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
              <Check className="h-3 w-3" />
              Done — {truncate(stringifyResult(result))}
            </p>
          )}
          {state === "cancelled" && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <X className="h-3 w-3" />
              Cancelled
            </p>
          )}
          {state === "expired" && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-3 w-3" />
              Expired (5-minute window passed)
            </p>
          )}
          {state === "error" && error && (
            <p className="text-red-600">Error: {error}</p>
          )}

          {isPending && (
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={handleConfirm}
                disabled={buttonsDisabled}
              >
                {state === "pending" ? "Confirm" : "Confirming…"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmCancelOpen(true)}
                disabled={buttonsDisabled}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading">
              Cancel this action?
            </DialogTitle>
            <DialogDescription className="font-body">
              The assistant will not perform this action. You can ask again
              later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmCancelOpen(false)}
            >
              Keep
            </Button>
            <Button variant="destructive" onClick={handleCancel}>
              Cancel action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ActionApprovalList({
  actions,
  onConfirmed,
}: {
  actions: PendingActionEvent[];
  /**
   * Fires when a card resolves to "executed". The parent uses this to record
   * the executed tool result as a synthetic assistant message AND auto-fire a
   * `[continue]` follow-up so the agent can complete remaining steps.
   */
  onConfirmed?: (action: PendingActionEvent, result: unknown) => void;
}) {
  // Subscribe so the list re-renders (and unhides the next pending card) when
  // any action's runtime state flips.
  useActionStoreTick();
  if (!actions || actions.length === 0) return null;
  // Serialize approvals: render every already-resolved card (so the user keeps
  // a record of what they confirmed) plus the *first* still-pending card.
  // Subsequent pending cards stay hidden until the user resolves the prior one.
  // This avoids the "two modals racing while the first is still executing"
  // confusion when the agent emits multiple HITL writes in one turn.
  // We re-derive on every render via the runtime store; resolution flips the
  // pending card to "executed/cancelled/error/expired" which then unhides the next.
  const visible: PendingActionEvent[] = [];
  let pendingShown = false;
  for (const a of actions) {
    if (isActionResolved(a.actionId)) {
      visible.push(a);
    } else if (!pendingShown) {
      visible.push(a);
      pendingShown = true;
    }
    // else: a later pending card, hidden for now.
  }
  return (
    <div className="space-y-1.5">
      {visible.map((a) => (
        <ActionApprovalCard
          key={a.actionId}
          action={a}
          onConfirmed={(result) => onConfirmed?.(a, result)}
        />
      ))}
    </div>
  );
}
