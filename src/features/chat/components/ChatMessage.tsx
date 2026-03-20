import { Bot, FileText } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { getTextDir } from "@/lib/utils";
import { CitationMarker } from "./CitationMarker";
import type { Message, Citation } from "@/types/session";

interface ChatMessageProps {
  message: Message;
}

interface StreamingMessageProps {
  content: string;
  citations: Citation[];
}

function formatMetrics(metrics: { ttftMs: number; totalMs: number }): string {
  const ttft = (metrics.ttftMs / 1000).toFixed(1);
  const total = (metrics.totalMs / 1000).toFixed(1);
  return `TTFT: ${ttft}s | Total: ${total}s`;
}

function renderContentWithCitations(
  content: string,
  citations: Citation[]
): React.ReactNode {
  if (!citations || citations.length === 0) {
    return <Markdown>{content}</Markdown>;
  }

  // Split content by citation markers [N]
  const parts = content.split(/(\[\d+\])/g);

  const dir = getTextDir(content);

  return (
    <div className="prose prose-sm max-w-none" dir={dir}>
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (match) {
          const idx = parseInt(match[1], 10);
          const citation = citations.find((c) => c.index === idx);
          if (citation) {
            return (
              <CitationMarker key={i} index={idx} citation={citation} />
            );
          }
        }
        if (part) {
          return <Markdown key={i}>{part}</Markdown>;
        }
        return null;
      })}
    </div>
  );
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isSummary = message.role === "summary";

  if (isSummary) {
    return (
      <div className="flex gap-3">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100">
          <FileText className="h-3.5 w-3.5 text-amber-700" />
        </div>
        <div className="min-w-0 flex-1 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="font-heading text-xs font-medium text-amber-700">
            Session Summary
          </p>
          <div dir={getTextDir(message.content)}>
            <Markdown>{message.content}</Markdown>
          </div>
        </div>
      </div>
    );
  }

  if (isUser) {
    const dir = getTextDir(message.content);
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[75%] rounded-2xl rounded-br-sm bg-foreground px-4 py-2.5 text-sm text-background"
          dir={dir}
        >
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted mt-0.5">
        <Bot className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        {renderContentWithCitations(
          message.content,
          message.citations ?? []
        )}
        {message.metrics && (
          <p className="text-[11px] text-muted-foreground/50">
            {formatMetrics(message.metrics)}
          </p>
        )}
      </div>
    </div>
  );
}

export function StreamingMessage({
  content,
  citations,
}: StreamingMessageProps) {
  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted mt-0.5">
        <Bot className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        {content ? (
          renderContentWithCitations(content, citations)
        ) : (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground/50" />
            Thinking...
          </div>
        )}
      </div>
    </div>
  );
}
