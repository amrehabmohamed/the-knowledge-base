import { Bot, User } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
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

  return (
    <div className="prose prose-sm max-w-none">
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

  return (
    <div className={`flex gap-3 ${isUser ? "" : ""}`}>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
        {isUser ? (
          <User className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        {isUser ? (
          <p className="text-sm">{message.content}</p>
        ) : (
          renderContentWithCitations(
            message.content,
            message.citations ?? []
          )
        )}

        {!isUser && message.metrics && (
          <p className="text-[11px] text-muted-foreground/60">
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
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <Bot className="h-4 w-4 text-muted-foreground" />
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
