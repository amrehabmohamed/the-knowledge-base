import { useState } from "react";
import { RotateCcw, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { GEMINI_MODELS } from "@/config/constants";

interface ChatHeaderProps {
  modelId: string;
  onModelChange: (modelId: string) => void;
  onReset: () => void;
  hasMessages: boolean;
  totalTokens?: number;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K tokens`;
  return `${tokens} tokens`;
}

export function ChatHeader({
  modelId,
  onModelChange,
  onReset,
  hasMessages,
  totalTokens = 0,
}: ChatHeaderProps) {
  const [resetOpen, setResetOpen] = useState(false);
  const currentModel =
    GEMINI_MODELS.find((m) => m.id === modelId) ?? GEMINI_MODELS[0];

  return (
    <>
      <div className="flex items-center justify-between border-b px-4 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
                {currentModel.label}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            }
          />
          <DropdownMenuContent align="start">
            {GEMINI_MODELS.map((model) => (
              <DropdownMenuItem
                key={model.id}
                onClick={() => onModelChange(model.id)}
                className={model.id === modelId ? "font-medium" : ""}
              >
                {model.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-3">
          {totalTokens > 0 && (
            <span className="font-body text-[11px] text-muted-foreground/60">
              {formatTokenCount(totalTokens)}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (hasMessages ? setResetOpen(true) : onReset())}
            className="gap-1.5 text-xs text-muted-foreground"
          >
          <RotateCcw className="h-3.5 w-3.5" />
          New Chat
        </Button>
        </div>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start New Chat</DialogTitle>
            <DialogDescription>
              This will archive the current conversation and start a fresh chat
              session. Your sources will remain selected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setResetOpen(false);
                onReset();
              }}
            >
              Start New Chat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
