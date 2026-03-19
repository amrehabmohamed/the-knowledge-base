import { Progress } from "@/components/ui/progress";

interface UploadProgressProps {
  progress: Map<string, number>;
}

export function UploadProgress({ progress }: UploadProgressProps) {
  if (progress.size === 0) return null;

  return (
    <div className="border-b px-4 py-2 space-y-2">
      {Array.from(progress.entries()).map(([sourceId, pct]) => (
        <div key={sourceId} className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Uploading...</span>
            <span>{Math.round(pct)}%</span>
          </div>
          <Progress value={pct} className="h-1.5" />
        </div>
      ))}
    </div>
  );
}
