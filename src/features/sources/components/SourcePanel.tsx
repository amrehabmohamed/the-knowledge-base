import { useState } from "react";
import { Upload, Link, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { useFileUpload } from "../hooks/useFileUpload";
import { SourceCard } from "./SourceCard";
import { UploadProgress } from "./UploadProgress";
import { UrlInput } from "./UrlInput";
import { UploadDialog } from "./UploadDialog";
import type { Source, SourceTag } from "@/types/source";

interface SourcePanelProps {
  notebookId: string;
  userId: string;
  sources: Source[];
  loading: boolean;
}

export function SourcePanel({
  notebookId,
  userId,
  sources,
  loading,
}: SourcePanelProps) {
  const {
    uploading,
    progress,
    startUpload,
    removeSource,
    retrySource,
  } = useFileUpload(notebookId, userId);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);

  const handleUploadConfirm = (files: File[], tags: SourceTag[]) => {
    startUpload(files, tags);
  };

  const existingNames = sources.map((s) => s.displayName);
  const existingUrls = sources
    .filter((s) => s.originalUrl)
    .map((s) => s.originalUrl!);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="font-heading text-sm font-semibold">Sources</h2>
          {!loading && (
            <span className="text-xs text-muted-foreground">
              ({sources.length})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowUrlInput(!showUrlInput)}
            className="gap-1 text-xs"
          >
            <Link className="h-3.5 w-3.5" />
            URL
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowUploadDialog(true)}
            disabled={uploading}
            className="gap-1 text-xs"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload
          </Button>
        </div>
      </div>

      {/* URL Input */}
      {showUrlInput && (
        <UrlInput
          notebookId={notebookId}
          existingUrls={existingUrls}
          onClose={() => setShowUrlInput(false)}
        />
      )}

      {/* Upload Progress */}
      {uploading && <UploadProgress progress={progress} />}

      {/* Source List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader variant="circular" size="md" />
          </div>
        ) : sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <FileText className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No sources yet. Upload files or add URLs to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {sources.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                onRetry={() => retrySource(source.id)}
                onDelete={() => removeSource(source.id, source.storageRef)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Upload Dialog */}
      <UploadDialog
        open={showUploadDialog}
        onOpenChange={setShowUploadDialog}
        existingNames={existingNames}
        onConfirm={handleUploadConfirm}
      />
    </div>
  );
}
