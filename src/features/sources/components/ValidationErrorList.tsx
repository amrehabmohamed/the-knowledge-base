import { useEffect } from "react";
import { X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ValidationError } from "../services/uploadService";

interface ValidationErrorListProps {
  errors: ValidationError[];
  onDismiss: () => void;
}

export function ValidationErrorList({
  errors,
  onDismiss,
}: ValidationErrorListProps) {
  // Auto-dismiss after 10 seconds
  useEffect(() => {
    const timer = setTimeout(onDismiss, 10000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  if (errors.length === 0) return null;

  return (
    <div className="border-b bg-destructive/5 px-4 py-2">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="space-y-1">
            {errors.map((err, i) => (
              <p key={i} className="text-xs text-destructive">
                <span className="font-medium">{err.fileName}:</span>{" "}
                {err.error}
              </p>
            ))}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDismiss}
          className="shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
