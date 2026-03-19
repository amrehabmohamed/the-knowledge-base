import { useState } from "react";
import { Link, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUrlIngest } from "../hooks/useUrlIngest";

interface UrlInputProps {
  notebookId: string;
  existingUrls: string[];
  onClose: () => void;
}

export function UrlInput({ notebookId, existingUrls, onClose }: UrlInputProps) {
  const [url, setUrl] = useState("");
  const { submitting, error, submitUrl, clearError } =
    useUrlIngest(notebookId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await submitUrl(url, existingUrls);
    if (success) {
      setUrl("");
      onClose();
    }
  };

  return (
    <div className="border-b px-4 py-3">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <Link className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          type="url"
          placeholder="https://example.com/article"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) clearError();
          }}
          disabled={submitting}
          className="h-8 text-sm"
          autoFocus
        />
        <Button type="submit" size="sm" disabled={submitting || !url.trim()}>
          {submitting ? "Adding..." : "Add"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          disabled={submitting}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </form>
      {error && (
        <p className="mt-1.5 text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
