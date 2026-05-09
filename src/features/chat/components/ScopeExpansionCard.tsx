import { useEffect, useState } from "react";
import {
  Calendar,
  Check,
  ChevronDown,
  KeyRound,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  startConnectorOAuth,
  type ScopeExpansionEvent,
} from "@/lib/connectors";
import {
  setScopeState,
  useScopeState,
} from "@/lib/connectorActionStore";

type State = "pending" | "granting" | "granted" | "error";

interface ScopeExpansionCardProps {
  event: ScopeExpansionEvent;
  onGranted?: () => void;
}

const PROVIDER_META: Record<
  string,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  google_calendar: { label: "Google Calendar", icon: Calendar },
};

function humanScope(scope: string): string {
  const map: Record<string, string> = {
    "https://www.googleapis.com/auth/calendar.events":
      "Create and modify events",
    "https://www.googleapis.com/auth/calendar.readonly": "Read events",
    "https://www.googleapis.com/auth/calendar.freebusy":
      "Check free/busy times",
  };
  return map[scope] ?? scope;
}

function StatusIcon({ state }: { state: State }) {
  if (state === "granting") {
    return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
  }
  if (state === "granted") return <Check className="h-3 w-3 text-green-600" />;
  if (state === "error") return <KeyRound className="h-3 w-3 text-red-500" />;
  return <KeyRound className="h-3 w-3 text-blue-700 dark:text-blue-400" />;
}

export function ScopeExpansionCard({
  event,
  onGranted,
}: ScopeExpansionCardProps) {
  const meta = PROVIDER_META[event.provider] ?? {
    label: event.provider,
    icon: ShieldAlert,
  };
  const Icon = meta.icon;

  const key = `${event.provider}:${event.tool}`;
  const runtime = useScopeState(key);
  // Runtime is the source of truth. With no runtime we always fall back to
  // 'pending' (button still works — user can grant access from a previous turn).
  const state: State = runtime?.state ?? "pending";
  const error = runtime?.error ?? null;
  const [open, setOpen] = useState<boolean>(state === "pending");

  useEffect(() => {
    if (state === "pending") setOpen(true);
    else setOpen(false);
  }, [state]);

  const handleGrant = async () => {
    setScopeState(key, { state: "granting", error: undefined });
    try {
      const url = await startConnectorOAuth(event.provider, "expand");
      const popup = window.open(
        url,
        "connector-oauth",
        "width=500,height=650"
      );
      if (!popup) {
        throw new Error(
          "Popup was blocked. Please allow popups for this site."
        );
      }
      await new Promise<void>((resolve, reject) => {
        const onMessage = (e: MessageEvent) => {
          const d = e.data as
            | { type?: string; provider?: string; error?: string }
            | undefined;
          if (!d?.type) return;
          if (d.type === "connector:connected") {
            window.removeEventListener("message", onMessage);
            resolve();
          } else if (d.type === "connector:error") {
            window.removeEventListener("message", onMessage);
            reject(new Error(d.error ?? "OAuth flow failed."));
          }
        };
        window.addEventListener("message", onMessage);
      });
      setScopeState(key, { state: "granted" });
      onGranted?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to grant.";
      setScopeState(key, { state: "error", error: msg });
    }
  };

  const isPending = state === "pending";

  const headerClass =
    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left " +
    (isPending ? "cursor-default" : "hover:bg-muted/60 cursor-pointer");

  const stateLabel: Record<State, string> = {
    pending: `${meta.label} needs additional access`,
    granting: `${meta.label} — opening Google…`,
    granted: `${meta.label} — access granted`,
    error: `${meta.label} — grant failed`,
  };

  return (
    <div
      className={
        "rounded-md border text-xs " +
        (isPending
          ? "border-blue-300/60 bg-blue-50/60 dark:border-blue-500/30 dark:bg-blue-500/5"
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
              ? "text-blue-700 dark:text-blue-400"
              : "text-muted-foreground")
          }
        />
        <span className="font-medium text-foreground">{stateLabel[state]}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
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
              To do this, your assistant needs:
            </p>
          )}
          <ul className="ml-3 list-disc space-y-0.5 font-body text-xs text-foreground/80">
            {event.missingScopes.map((s) => (
              <li key={s}>{humanScope(s)}</li>
            ))}
          </ul>

          {state === "granted" && (
            <p className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
              <Check className="h-3 w-3" />
              Access granted. Ask the assistant again to continue.
            </p>
          )}
          {state === "error" && error && (
            <p className="text-red-600">Error: {error}</p>
          )}

          {isPending && (
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" onClick={handleGrant}>
                <KeyRound className="h-3 w-3" />
                Grant access
              </Button>
            </div>
          )}
          {state === "granting" && (
            <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Opening Google…
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ScopeExpansionList({
  events,
}: {
  events: ScopeExpansionEvent[];
}) {
  if (!events || events.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {events.map((e, i) => (
        <ScopeExpansionCard
          key={`${e.provider}-${e.tool}-${i}`}
          event={e}
        />
      ))}
    </div>
  );
}
