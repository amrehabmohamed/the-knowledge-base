import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FileText, Globe } from "lucide-react";
import type { Citation } from "@/types/session";

interface CitationPanelProps {
  citation: Citation;
  open: boolean;
  onClose: () => void;
}

export function CitationPanel({ citation, open, onClose }: CitationPanelProps) {
  const isWeb = citation.type === "web";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isWeb ? (
              <Globe className="h-4 w-4 text-emerald-600" />
            ) : (
              <FileText className="h-4 w-4 text-muted-foreground" />
            )}
            {citation.sourceName}
          </DialogTitle>
          <DialogDescription>
            {isWeb ? "Web source" : "Source excerpt"}
          </DialogDescription>
        </DialogHeader>
        {isWeb && citation.url && (
          <a
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline truncate block"
          >
            {citation.url}
          </a>
        )}
        <div className="max-h-60 overflow-y-auto rounded-md bg-muted/50 p-3 text-sm leading-relaxed">
          {citation.chunkText || "No excerpt available."}
        </div>
      </DialogContent>
    </Dialog>
  );
}
