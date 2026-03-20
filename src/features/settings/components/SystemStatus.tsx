import { Button } from "@/components/ui/button";
import { useSystemStatusContext } from "../context/SystemStatusContext";

const STATUS_CONFIG = {
  ready: { dot: "bg-green-500", label: "Ready" },
  sleeping: { dot: "bg-gray-400", label: "Sleeping" },
  warming: { dot: "bg-amber-500 animate-pulse", label: "Warming Up" },
  partial: { dot: "bg-yellow-500", label: "Partially Ready" },
} as const;

export function SystemStatus() {
  const { status, warmUp } = useSystemStatusContext();
  const config = STATUS_CONFIG[status];

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${config.dot}`} />
      <span className="font-body text-xs text-muted-foreground">
        {config.label}
      </span>
      {(status === "sleeping" || status === "partial") && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 font-body text-xs"
          onClick={warmUp}
        >
          Start Your Engines
        </Button>
      )}
    </div>
  );
}
