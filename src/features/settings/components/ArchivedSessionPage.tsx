import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { AppLayout } from "@/components/layout/AppLayout";
import { ChatMessage } from "@/features/chat/components/ChatMessage";
import { useArchivedSession } from "../hooks/useArchivedSession";
import { formatRelativeTime } from "@/lib/formatters";

export function ArchivedSessionPage() {
  const { notebookId = "", sessionId = "" } = useParams();
  const navigate = useNavigate();
  const { session, messages, notebookName, loading } = useArchivedSession(
    notebookId,
    sessionId
  );

  if (loading) {
    return (
      <AppLayout>
        <div className="flex flex-1 items-center justify-center py-16">
          <Loader variant="circular" size="lg" />
        </div>
      </AppLayout>
    );
  }

  if (!session) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center py-16 text-center">
          <Archive className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <h3 className="font-heading text-lg font-medium text-muted-foreground">
            Session not found
          </h3>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => navigate("/settings/archive")}
          >
            Back to Archive
          </Button>
        </div>
      </AppLayout>
    );
  }

  const visibleMessages = messages.filter((m) => !m.superseded);

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/settings/archive")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="font-heading text-lg font-semibold">
              {notebookName}
            </h2>
            <p className="font-body text-xs text-muted-foreground">
              Archived{" "}
              {session.archivedAt
                ? formatRelativeTime(session.archivedAt.toDate())
                : ""}
              {" · "}
              {messages.length} messages
              {" · "}
              {session.totalTokens >= 1000
                ? `${(session.totalTokens / 1000).toFixed(1)}K`
                : session.totalTokens}{" "}
              tokens
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {visibleMessages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
