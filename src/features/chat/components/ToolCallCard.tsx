import { useState } from "react";
import {
  Globe,
  MapPin,
  Link as LinkIcon,
  FileSearch,
  ChevronDown,
  Loader2,
  Check,
  X,
} from "lucide-react";
import type { ToolCall } from "@/types/session";

const TOOL_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  web_search: { label: "Web search", icon: Globe },
  maps_search: { label: "Maps search", icon: MapPin },
  url_fetch: { label: "URL fetch", icon: LinkIcon },
  url_prefetch: { label: "URL prefetch", icon: LinkIcon },
  filesearch: { label: "File search", icon: FileSearch },
};

function formatArgs(args: Record<string, unknown>): string {
  if (typeof args.query === "string") return args.query;
  if (Array.isArray(args.urls)) return (args.urls as string[]).join(", ");
  if (typeof args.url === "string") return args.url;
  if (Object.keys(args).length === 0) return "";
  return JSON.stringify(args);
}

function StatusIcon({ status }: { status: ToolCall["status"] }) {
  if (status === "running") {
    return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
  }
  if (status === "error") {
    return <X className="h-3 w-3 text-red-500" />;
  }
  return <Check className="h-3 w-3 text-green-600" />;
}

export function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[toolCall.name] ?? {
    label: toolCall.name,
    icon: Globe,
  };
  const Icon = meta.icon;
  const argsLine = formatArgs(toolCall.args);
  const expandable =
    toolCall.status !== "running" &&
    Boolean(toolCall.output || toolCall.error);

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 text-xs">
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        className={
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left " +
          (expandable ? "hover:bg-muted/60 cursor-pointer" : "cursor-default")
        }
        disabled={!expandable}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">{meta.label}</span>
        {argsLine && (
          <span className="truncate text-muted-foreground">— {argsLine}</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {toolCall.durationMs !== undefined && toolCall.status !== "running" && (
            <span className="text-[10px] text-muted-foreground/70">
              {(toolCall.durationMs / 1000).toFixed(1)}s
            </span>
          )}
          <StatusIcon status={toolCall.status} />
          {expandable && (
            <ChevronDown
              className={
                "h-3 w-3 text-muted-foreground transition-transform " +
                (open ? "rotate-180" : "")
              }
            />
          )}
        </span>
      </button>
      {open && expandable && (
        <div className="border-t border-border/60 bg-background/40 px-2.5 py-2 space-y-1.5">
          {toolCall.error && (
            <p className="text-red-600">Error: {toolCall.error}</p>
          )}
          {toolCall.output && (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-muted-foreground max-h-72 overflow-auto">
              {toolCall.output}
            </pre>
          )}
          {toolCall.citations && toolCall.citations.length > 0 && (
            <div className="text-[11px] text-muted-foreground">
              {toolCall.citations.length} citation
              {toolCall.citations.length === 1 ? "" : "s"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolCallList({ toolCalls }: { toolCalls: ToolCall[] }) {
  if (!toolCalls || toolCalls.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {toolCalls.map((tc) => (
        <ToolCallCard key={tc.id} toolCall={tc} />
      ))}
    </div>
  );
}
