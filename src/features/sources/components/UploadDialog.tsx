import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Upload,
  FileText,
  Check,
  AlertCircle,
  Plus,
  X,
} from "lucide-react";
import { validateBatch, type ValidationError } from "../services/uploadService";
import { formatFileSize } from "@/lib/formatters";
import { FILE_INPUT_ACCEPT } from "@/config/constants";
import type { SourceTag } from "@/types/source";

const MAX_TAGS = 5;

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingNames: string[];
  onConfirm: (files: File[], tags: SourceTag[]) => void;
}

export function UploadDialog({
  open,
  onOpenChange,
  existingNames,
  onConfirm,
}: UploadDialogProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [validFiles, setValidFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [tags, setTags] = useState<Array<{ key: string; value: string }>>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = (files: FileList | File[]) => {
    const fileList = files instanceof FileList ? files : null;
    const fileArray = files instanceof FileList ? Array.from(files) : files;
    setSelectedFiles(fileArray);

    // Create a fake FileList-like for validation
    const fakeFileList = fileList ?? Object.assign(fileArray, {
      item: (i: number) => fileArray[i] ?? null,
    }) as unknown as FileList;

    const result = validateBatch(fakeFileList, existingNames);
    setValidFiles(result.validFiles);
    setErrors(result.errors);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const removeFile = (index: number) => {
    const updated = selectedFiles.filter((_, i) => i !== index);
    if (updated.length === 0) {
      setSelectedFiles([]);
      setValidFiles([]);
      setErrors([]);
    } else {
      processFiles(updated);
    }
  };

  const addTag = () => {
    if (tags.length >= MAX_TAGS) return;
    setTags([...tags, { key: "", value: "" }]);
  };

  const removeTag = (index: number) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  const updateTag = (index: number, field: "key" | "value", val: string) => {
    const updated = [...tags];
    updated[index] = { ...updated[index], [field]: val };
    setTags(updated);
  };

  const handleConfirm = () => {
    const validTags = tags.filter((t) => t.key.trim() && t.value.trim());
    onConfirm(validFiles, validTags);
    resetState();
    onOpenChange(false);
  };

  const handleCancel = () => {
    resetState();
    onOpenChange(false);
  };

  const resetState = () => {
    setSelectedFiles([]);
    setValidFiles([]);
    setErrors([]);
    setTags([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Files</DialogTitle>
          <DialogDescription>
            Select files and optionally add tags as metadata.
          </DialogDescription>
        </DialogHeader>

        {/* Drop Zone / File Picker */}
        {selectedFiles.length === 0 ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
              isDragging
                ? "border-foreground/40 bg-muted/50"
                : "border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-muted/30"
            }`}
          >
            <Upload className="mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">
              Drop files here or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              PDF, DOCX, TXT, CSV, and more — up to 50 MB each
            </p>
          </div>
        ) : (
          /* File List */
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Files ({validFiles.length} valid
                {errors.length > 0 ? `, ${errors.length} rejected` : ""})
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="h-6 gap-1 px-2 text-xs"
              >
                <Plus className="h-3 w-3" />
                Add more
              </Button>
            </div>
            <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border p-2">
              {validFiles.map((file, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <Check className="h-3.5 w-3.5 shrink-0 text-green-600" />
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{file.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatFileSize(file.size)}
                  </span>
                  <button
                    onClick={() => removeFile(selectedFiles.indexOf(file))}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {errors.map((err, i) => (
                <div key={`err-${i}`} className="flex items-center gap-2 text-sm">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  <span className="truncate text-muted-foreground">
                    {err.fileName}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-destructive">
                    {err.error}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={FILE_INPUT_ACCEPT}
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Tags Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              Tags ({tags.length}/{MAX_TAGS})
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addTag}
              disabled={tags.length >= MAX_TAGS}
              className="h-6 gap-1 px-2 text-xs"
            >
              <Plus className="h-3 w-3" />
              Add Tag
            </Button>
          </div>

          {tags.length === 0 ? (
            <p className="text-xs text-muted-foreground/60 italic">
              No tags added. Tags help organize and filter your sources.
            </p>
          ) : (
            <div className="space-y-2">
              {tags.map((tag, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder="Key"
                    value={tag.key}
                    onChange={(e) => updateTag(i, "key", e.target.value)}
                    className="h-8 text-sm"
                  />
                  <Input
                    placeholder="Value"
                    value={tag.value}
                    onChange={(e) => updateTag(i, "value", e.target.value)}
                    className="h-8 text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeTag(i)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={validFiles.length === 0}>
            Upload {validFiles.length} file{validFiles.length !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
