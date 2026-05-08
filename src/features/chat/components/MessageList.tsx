import { useEffect, useRef } from "react";
import { ChatMessage, StreamingMessage } from "./ChatMessage";
import type { Message, Citation, ToolCall } from "@/types/session";

interface MessageListProps {
  messages: Message[];
  streaming: boolean;
  streamingContent: string;
  streamingCitations: Citation[];
  streamingToolCalls: ToolCall[];
}

export function MessageList({
  messages,
  streaming,
  streamingContent,
  streamingCitations,
  streamingToolCalls,
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
            <ChatMessage key={msg.id} message={msg} />
          ))}

        {streaming && (
          <StreamingMessage
            content={streamingContent}
            citations={streamingCitations}
            toolCalls={streamingToolCalls}
          />
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
