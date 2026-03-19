import { MessageSquare } from "lucide-react";
import { Loader } from "@/components/ui/loader";
import { useChat } from "../hooks/useChat";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import type { Source } from "@/types/source";

interface ChatPanelProps {
  notebookId: string;
  sources: Source[];
}

export function ChatPanel({ notebookId, sources }: ChatPanelProps) {
  const {
    session,
    messages,
    streaming,
    streamingContent,
    streamingCitations,
    error,
    loading,
    readySources,
    sendMessage,
    resetSession,
    updateModel,
  } = useChat(notebookId, sources);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader variant="circular" size="lg" />
      </div>
    );
  }

  const hasReadySources = readySources.length > 0;

  return (
    <div className="flex flex-1 flex-col">
      {session && (
        <ChatHeader
          modelId={session.modelId}
          onModelChange={updateModel}
          onReset={resetSession}
          hasMessages={messages.length > 0}
        />
      )}

      {!hasReadySources && messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-8">
          <MessageSquare className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <h3 className="font-heading text-lg font-medium text-muted-foreground">
            Add sources to start chatting
          </h3>
          <p className="font-body mt-1 max-w-sm text-center text-sm text-muted-foreground/70">
            Upload files or add URLs to your notebook. Once sources are ready,
            you can ask questions and get cited answers.
          </p>
        </div>
      ) : (
        <MessageList
          messages={messages}
          streaming={streaming}
          streamingContent={streamingContent}
          streamingCitations={streamingCitations}
        />
      )}

      {error && (
        <div className="border-t bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <ChatInput
        onSend={sendMessage}
        disabled={!hasReadySources || !session}
        streaming={streaming}
      />
    </div>
  );
}
