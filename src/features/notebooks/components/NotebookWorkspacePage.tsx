import { useParams, useNavigate, Navigate } from "react-router-dom";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { useNotebook } from "../hooks/useNotebook";
import { SourcePanel } from "@/features/sources/components/SourcePanel";
import { useAuthContext } from "@/features/auth";

export function NotebookWorkspacePage() {
  const { notebookId } = useParams<{ notebookId: string }>();
  const { notebook, loading, error } = useNotebook(notebookId);
  const { user } = useAuthContext();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader variant="circular" size="lg" />
      </div>
    );
  }

  if (error || !notebook) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="font-heading text-lg font-semibold truncate">
          {notebook.name}
        </h1>
      </header>

      {/* Workspace: Source Panel + Chat Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Source Panel */}
        <div className="w-[350px] shrink-0 border-r overflow-y-auto">
          <SourcePanel notebookId={notebookId!} userId={user!.uid} />
        </div>

        {/* Chat Area (placeholder for Phase 1B) */}
        <div className="flex flex-1 flex-col items-center justify-center px-8">
          <MessageSquare className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <h3 className="font-heading text-lg font-medium text-muted-foreground">
            Chat coming soon
          </h3>
          <p className="font-body mt-1 max-w-sm text-center text-sm text-muted-foreground/70">
            Add sources to your notebook first. Once you have sources ready,
            you'll be able to ask questions and get cited answers.
          </p>
        </div>
      </div>
    </div>
  );
}
