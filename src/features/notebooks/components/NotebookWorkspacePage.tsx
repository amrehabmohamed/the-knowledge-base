import { useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { updateDoc, serverTimestamp } from "firebase/firestore";
import { ArrowLeft, Settings, Eye, Pencil } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { getNotebookRef } from "@/lib/firestore";
import { useNotebook } from "../hooks/useNotebook";
import { useSources } from "@/features/sources/hooks/useSources";
import { SourcePanel } from "@/features/sources/components/SourcePanel";
import { ChatPanel } from "@/features/chat/components/ChatPanel";
import { useAuthContext } from "@/features/auth";

export function NotebookWorkspacePage() {
  const { notebookId } = useParams<{ notebookId: string }>();
  const { notebook, loading, error } = useNotebook(notebookId);
  const { sources, loading: sourcesLoading } = useSources(notebookId ?? "");
  const { user } = useAuthContext();
  const navigate = useNavigate();

  const [promptOpen, setPromptOpen] = useState(false);
  const [promptValue, setPromptValue] = useState("");
  const [promptPreview, setPromptPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  const openPromptDialog = () => {
    setPromptValue(notebook?.systemPrompt ?? "");
    setPromptPreview(false);
    setPromptOpen(true);
  };

  const savePrompt = async () => {
    if (!notebookId) return;
    setSaving(true);
    try {
      await updateDoc(getNotebookRef(notebookId), {
        systemPrompt: promptValue.trim() || null,
        updatedAt: serverTimestamp(),
      });
      setPromptOpen(false);
    } catch (err) {
      console.error("Failed to save system prompt:", err);
    } finally {
      setSaving(false);
    }
  };

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
        <h1 className="font-heading text-lg font-semibold truncate flex-1">
          {notebook.name}
        </h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={openPromptDialog}
          className="gap-1.5 text-xs text-muted-foreground"
        >
          <Settings className="h-3.5 w-3.5" />
          System Prompt
        </Button>
      </header>

      {/* System Prompt Dialog */}
      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent className="flex max-h-[80vh] flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>System Prompt</DialogTitle>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => setPromptPreview((p) => !p)}
              >
                {promptPreview ? (
                  <>
                    <Pencil className="h-3 w-3" />
                    Edit
                  </>
                ) : (
                  <>
                    <Eye className="h-3 w-3" />
                    Preview
                  </>
                )}
              </Button>
            </div>
            <DialogDescription>
              Customize how the AI assistant behaves for this notebook. This is
              appended to the default instructions. Supports markdown.
            </DialogDescription>
          </DialogHeader>
          {promptPreview ? (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-3 prose prose-sm max-w-none">
              {promptValue ? (
                <Markdown>{promptValue}</Markdown>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Nothing to preview
                </p>
              )}
            </div>
          ) : (
            <Textarea
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              placeholder="e.g., Always respond in Arabic. Focus on summarizing key findings."
              className="min-h-0 flex-1 resize-none overflow-y-auto font-body text-sm"
            />
          )}
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setPromptOpen(false)}>
              Cancel
            </Button>
            <Button onClick={savePrompt} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Workspace: Source Panel + Chat Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Source Panel */}
        <div className="w-[350px] shrink-0 border-r overflow-y-auto">
          <SourcePanel
            notebookId={notebookId!}
            userId={user!.uid}
            sources={sources}
            loading={sourcesLoading}
          />
        </div>

        {/* Chat Panel */}
        <ChatPanel notebookId={notebookId!} sources={sources} />
      </div>
    </div>
  );
}
