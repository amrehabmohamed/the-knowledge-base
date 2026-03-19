import { useEffect, useRef } from "react";
import { ChatMessage, StreamingMessage } from "./ChatMessage";
import type { Message, Citation } from "@/types/session";

interface MessageListProps {
  messages: Message[];
  streaming: boolean;
  streamingContent: string;
  streamingCitations: Citation[];
}

export function MessageList({
  messages,
  streaming,
  streamingContent,
  streamingCitations,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingContent]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-2xl space-y-6">
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {streaming && (
          <StreamingMessage
            content={streamingContent}
            citations={streamingCitations}
          />
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
