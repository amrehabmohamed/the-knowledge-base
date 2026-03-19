import { useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from "@/components/ui/prompt-input";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
  streaming: boolean;
}

export function ChatInput({ onSend, disabled, streaming }: ChatInputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <div className="border-t px-4 py-3">
      <PromptInput
        value={value}
        onValueChange={setValue}
        isLoading={streaming}
        onSubmit={handleSubmit}
        disabled={disabled}
        maxHeight={160}
      >
        <PromptInputTextarea
          placeholder={
            disabled
              ? "Add sources to start chatting..."
              : "Ask a question about your sources..."
          }
        />
        <PromptInputActions>
          <PromptInputAction
            tooltip={streaming ? "Streaming..." : "Send message"}
          >
            <div
              role="button"
              tabIndex={0}
              onClick={handleSubmit}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-foreground text-background ${disabled || !value.trim() ? "pointer-events-none opacity-40" : ""}`}
            >
              {streaming ? (
                <Square className="h-3.5 w-3.5" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </div>
          </PromptInputAction>
        </PromptInputActions>
      </PromptInput>
    </div>
  );
}
