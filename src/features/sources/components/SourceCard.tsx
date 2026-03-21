import {
  FileText,
  FileSpreadsheet,
  FileCode,
  File,
  Check,
  RefreshCw,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { SOURCE_STATUS_CONFIG } from "@/config/constants";
import { formatFileSize, formatRelativeTime } from "@/lib/formatters";
import type { Source } from "@/types/source";

interface SourceCardProps {
  source: Source;
  onRetry: () => void;
  onDelete: () => void;
}

function getSourceIcon(fileType: string) {
  if (
    fileType.includes("spreadsheet") ||
    fileType.includes("csv") ||
    fileType.includes("tab-separated")
  ) {
    return FileSpreadsheet;
  }
  if (
    fileType.includes("javascript") ||
    fileType.includes("typescript") ||
    fileType.includes("python") ||
    fileType.includes("java") ||
    fileType.includes("x-c") ||
    fileType.includes("x-go") ||
    fileType.includes("x-ruby") ||
    fileType.includes("x-php") ||
    fileType.includes("x-shellscript") ||
    fileType.includes("x-r") ||
    fileType.includes("x-sql") ||
    fileType.includes("json") ||
    fileType.includes("xml") ||
    fileType.includes("yaml")
  ) {
    return FileCode;
  }
  if (
    fileType.includes("text") ||
    fileType.includes("pdf") ||
    fileType.includes("document") ||
    fileType.includes("presentation") ||
    fileType.includes("html") ||
    fileType.includes("markdown")
  ) {
    return FileText;
  }
  return File;
}

export function SourceCard({ source, onRetry, onDelete }: SourceCardProps) {
  const Icon = getSourceIcon(source.fileType);
  const statusConfig = SOURCE_STATUS_CONFIG[source.status];
  const createdAt = source.createdAt?.toDate
    ? formatRelativeTime(source.createdAt.toDate())
    : "";

  return (
    <div className="group flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/50">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{source.displayName}</p>

        <div className="mt-1 flex items-center gap-2">
          <Badge
            variant="secondary"
            className={`text-[10px] px-1.5 py-0 ${statusConfig.color}`}
          >
            {source.status === "indexing" && (
              <Loader variant="circular" size="sm" className="mr-1 h-3 w-3" />
            )}
            {source.status === "ready" && (
              <Check className="mr-0.5 h-3 w-3" />
            )}
            {source.status === "failed" && (
              <AlertCircle className="mr-0.5 h-3 w-3" />
            )}
            {statusConfig.label}
          </Badge>

          {source.sizeBytes != null && (
            <span className="text-[10px] text-muted-foreground">
              {formatFileSize(source.sizeBytes)}
            </span>
          )}

          {createdAt && (
            <span className="text-[10px] text-muted-foreground">
              {createdAt}
            </span>
          )}

          {source.status === "ready" && source.processingMs != null && (
            <span className="text-[10px] text-muted-foreground">
              {(source.processingMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>

        {source.tags && source.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {source.tags.map((tag, i) => (
              <Badge
                key={i}
                variant="secondary"
                className="text-[9px] px-1.5 py-0 bg-muted text-muted-foreground"
              >
                {tag.key}: {tag.value}
              </Badge>
            ))}
          </div>
        )}

        {source.status === "failed" && source.failureReason && (
          <p className="mt-1 text-[11px] text-destructive">
            {source.failureReason}
          </p>
        )}

        {source.status === "failed" && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-6 px-2 text-xs"
            onClick={onRetry}
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        )}
      </div>

      {source.status !== "uploading" && source.status !== "fetching" && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
