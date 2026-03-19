import { useRef } from "react";
import { Upload, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { FILE_INPUT_ACCEPT } from "@/config/constants";
import { useSources } from "../hooks/useSources";
import { useFileUpload } from "../hooks/useFileUpload";
import { SourceCard } from "./SourceCard";
import { UploadProgress } from "./UploadProgress";
import { ValidationErrorList } from "./ValidationErrorList";

interface SourcePanelProps {
  notebookId: string;
  userId: string;
}

export function SourcePanel({ notebookId, userId }: SourcePanelProps) {
  const { sources, loading } = useSources(notebookId);
  const {
    uploading,
    progress,
    validationErrors,
    startUpload,
    clearValidationErrors,
    retrySource,
    removeSource,
  } = useFileUpload(notebookId, userId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const existingNames = sources.map((s) => s.displayName);
      startUpload(files, existingNames);
    }
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

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
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          Upload
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={FILE_INPUT_ACCEPT}
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <ValidationErrorList
          errors={validationErrors}
          onDismiss={clearValidationErrors}
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
              No sources yet. Upload files to get started.
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
    </div>
  );
}
