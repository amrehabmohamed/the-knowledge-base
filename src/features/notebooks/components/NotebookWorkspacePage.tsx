import { useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { updateDoc, serverTimestamp } from "firebase/firestore";
import { ArrowLeft, Settings, Eye, Pencil, Globe, MapPin, Link } from "lucide-react";
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
import type { NotebookTools } from "@/types/notebook";

type SettingsTab = "prompt" | "tools";

const TOOL_OPTIONS: Array<{
  key: keyof NotebookTools;
  label: string;
  description: string;
  icon: typeof Globe;
}> = [
  {
    key: "googleSearch",
    label: "Google Search",
    description: "Search the web for current events and information not in your sources",
    icon: Globe,
  },
  {
    key: "urlContext",
    label: "URL Context",
    description: "Read and analyze web pages mentioned in conversation",
    icon: Link,
  },
  {
    key: "googleMaps",
    label: "Google Maps",
    description: "Location-aware answers for travel and places",
    icon: MapPin,
  },
];

export function NotebookWorkspacePage() {
  const { notebookId } = useParams<{ notebookId: string }>();
  const { notebook, loading, error } = useNotebook(notebookId);
  const { sources, loading: sourcesLoading } = useSources(notebookId ?? "");
  const { user } = useAuthContext();
  const navigate = useNavigate();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("prompt");
  const [promptValue, setPromptValue] = useState("");
  const [promptPreview, setPromptPreview] = useState(false);
  const [toolsValue, setToolsValue] = useState<NotebookTools>({});
  const [saving, setSaving] = useState(false);

  const openSettings = (tab: SettingsTab = "prompt") => {
    setPromptValue(notebook?.systemPrompt ?? "");
    setToolsValue(notebook?.tools ?? {});
    setPromptPreview(false);
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  const saveSettings = async () => {
    if (!notebookId) return;
    setSaving(true);
    try {
      await updateDoc(getNotebookRef(notebookId), {
        systemPrompt: promptValue.trim() || null,
        tools: toolsValue,
        updatedAt: serverTimestamp(),
      });
      setSettingsOpen(false);
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  };

  const toggleTool = (key: keyof NotebookTools) => {
    setToolsValue((prev) => ({ ...prev, [key]: !prev[key] }));
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
          onClick={() => openSettings("prompt")}
          className="gap-1.5 text-xs text-muted-foreground"
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </Button>
      </header>

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="flex max-h-[80vh] flex-col">
          <DialogHeader>
            <DialogTitle>Notebook Settings</DialogTitle>
            <DialogDescription>
              Configure the AI assistant behavior and tools for this notebook.
            </DialogDescription>
          </DialogHeader>

          {/* Tab switcher */}
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            <button
              onClick={() => setSettingsTab("prompt")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                settingsTab === "prompt"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              System Prompt
            </button>
            <button
              onClick={() => setSettingsTab("tools")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                settingsTab === "tools"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Tools
            </button>
          </div>

          {/* Tab content */}
          {settingsTab === "prompt" && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Customize how the AI behaves. Appended to default instructions. Supports markdown.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs shrink-0"
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
            </>
          )}

          {settingsTab === "tools" && (
            <div className="flex-1 space-y-3 overflow-y-auto">
              <p className="text-xs text-muted-foreground">
                Enable additional AI capabilities for this notebook. Your uploaded sources are always searched.
              </p>
              {TOOL_OPTIONS.map(({ key, label, description, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleTool(key)}
                  className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
                >
                  <div className={`mt-0.5 rounded-md p-1.5 ${toolsValue[key] ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground">{description}</div>
                  </div>
                  <div
                    className={`mt-1 h-5 w-9 shrink-0 rounded-full transition-colors ${
                      toolsValue[key] ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                  >
                    <div
                      className={`h-4 w-4 translate-y-0.5 rounded-full bg-white shadow-sm transition-transform ${
                        toolsValue[key] ? "translate-x-[18px]" : "translate-x-0.5"
                      }`}
                    />
                  </div>
                </button>
              ))}
            </div>
          )}

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveSettings} disabled={saving}>
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
