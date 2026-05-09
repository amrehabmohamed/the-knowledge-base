import { useEffect, useRef } from "react";
import { ChatMessage, StreamingMessage } from "./ChatMessage";
import type {
  Message,
  Citation,
  ToolCall,
  ClarificationRecord,
} from "@/types/session";
import type {
  PendingActionEvent,
  ScopeExpansionEvent,
} from "@/lib/connectors";

interface MessageListProps {
  messages: Message[];
  streaming: boolean;
  streamingContent: string;
  streamingCitations: Citation[];
  streamingToolCalls: ToolCall[];
  pendingActions?: PendingActionEvent[];
  scopeExpansions?: ScopeExpansionEvent[];
  clarifications?: ClarificationRecord[];
  onClarificationSubmit?: (followUpMessage: string) => void;
  onActionConfirmed?: (action: PendingActionEvent, result: unknown) => void;
}

export function MessageList({
  messages,
  streaming,
  streamingContent,
  streamingCitations,
  streamingToolCalls,
  pendingActions,
  scopeExpansions,
  clarifications,
  onClarificationSubmit,
  onActionConfirmed,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingContent]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-3xl space-y-5">
        {messages
          .filter((msg) => !msg.superseded)
          .map((msg) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              onClarificationSubmit={onClarificationSubmit}
              onActionConfirmed={onActionConfirmed}
            />
          ))}

        {streaming && (
          <StreamingMessage
            content={streamingContent}
            citations={streamingCitations}
            toolCalls={streamingToolCalls}
            pendingActions={pendingActions}
            scopeExpansions={scopeExpansions}
            clarifications={clarifications}
            onClarificationSubmit={onClarificationSubmit}
            onActionConfirmed={onActionConfirmed}
          />
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
