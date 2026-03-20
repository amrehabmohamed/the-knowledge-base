import { useNavigate } from "react-router-dom";
import { Archive, ArrowLeft, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { AppLayout } from "@/components/layout/AppLayout";
import { useArchive } from "../hooks/useArchive";
import { formatRelativeTime } from "@/lib/formatters";

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

export function ArchivePage() {
  const navigate = useNavigate();
  const { items, loading, hasMore, loadMore } = useArchive();

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="font-heading text-xl font-semibold">Archive</h2>
        </div>

        {loading && items.length === 0 ? (
          <div className="flex justify-center py-16">
            <Loader variant="circular" size="lg" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <Archive className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <h3 className="font-heading text-lg font-medium text-muted-foreground">
              No archived sessions
            </h3>
            <p className="font-body mt-1 max-w-sm text-sm text-muted-foreground/70">
              Sessions are archived when you start a new chat. Your past
              conversations will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map(({ session, notebookName }) => (
              <button
                key={session.id}
                onClick={() =>
                  navigate(
                    `/settings/archive/${session.notebookId}/${session.id}`
                  )
                }
                className="flex w-full items-center gap-4 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-heading text-sm font-medium truncate">
                    {notebookName}
                  </p>
                  <div className="mt-0.5 flex items-center gap-3 font-body text-xs text-muted-foreground">
                    {session.archivedAt && (
                      <span>
                        {formatRelativeTime(session.archivedAt.toDate())}
                      </span>
                    )}
                    <span>{session.messageCount ?? 0} messages</span>
                    <span>{formatTokens(session.totalTokens)} tokens</span>
                  </div>
                </div>
              </button>
            ))}

            {hasMore && (
              <div className="pt-2 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMore}
                  disabled={loading}
                >
                  {loading ? "Loading..." : "Load More"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
