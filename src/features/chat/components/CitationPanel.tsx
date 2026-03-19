import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FileText } from "lucide-react";
import type { Citation } from "@/types/session";

interface CitationPanelProps {
  citation: Citation;
  open: boolean;
  onClose: () => void;
}

export function CitationPanel({ citation, open, onClose }: CitationPanelProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            {citation.sourceName}
          </DialogTitle>
          <DialogDescription>Source excerpt</DialogDescription>
        </DialogHeader>
        <div className="max-h-60 overflow-y-auto rounded-md bg-muted/50 p-3 text-sm leading-relaxed">
          {citation.chunkText || "No excerpt available."}
        </div>
      </DialogContent>
    </Dialog>
  );
}
