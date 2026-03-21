import { useState, useRef, useEffect } from "react";
import { ArrowUp, Square, Globe, MapPin, Link } from "lucide-react";
import { getTextDir } from "@/lib/utils";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from "@/components/ui/prompt-input";

const SLASH_COMMANDS = [
  {
    command: "/web ",
    label: "Web Search",
    description: "Search the web with Google",
    icon: Globe,
  },
  {
    command: "/maps ",
    label: "Google Maps",
    description: "Search locations and places",
    icon: MapPin,
  },
  {
    command: "/url ",
    label: "Read URL",
    description: "Read and analyze a web page",
    icon: Link,
  },
];

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
  streaming: boolean;
}

export function ChatInput({ onSend, disabled, streaming }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  // Show menu when input is exactly "/" or starts with "/" and is filtering
  useEffect(() => {
    if (value === "/") {
      setShowMenu(true);
      setSelectedIndex(0);
    } else if (value.startsWith("/") && !value.includes(" ")) {
      // Filter commands as user types
      const filtered = SLASH_COMMANDS.filter((cmd) =>
        cmd.command.trim().startsWith(value.toLowerCase())
      );
      setShowMenu(filtered.length > 0);
      setSelectedIndex(0);
    } else {
      setShowMenu(false);
    }
  }, [value]);

  const filteredCommands =
    value === "/"
      ? SLASH_COMMANDS
      : SLASH_COMMANDS.filter((cmd) =>
          cmd.command.trim().startsWith(value.toLowerCase())
        );

  const handleSelectCommand = (command: string) => {
    setValue(command);
    setShowMenu(false);
  };

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    setShowMenu(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showMenu) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < filteredCommands.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredCommands.length - 1
      );
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        handleSelectCommand(filteredCommands[selectedIndex].command);
      }
    } else if (e.key === "Escape") {
      setShowMenu(false);
    }
  };

  return (
    <div className="border-t px-4 py-3 relative">
      {/* Slash command menu */}
      {showMenu && filteredCommands.length > 0 && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-4 right-4 mb-1 rounded-lg border bg-popover shadow-lg overflow-hidden z-50"
        >
          <div className="p-1">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Tools
            </div>
            {filteredCommands.map((cmd, index) => {
              const Icon = cmd.icon;
              return (
                <button
                  key={cmd.command}
                  onClick={() => handleSelectCommand(cmd.command)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors ${
                    index === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-accent/50"
                  }`}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="text-left">
                    <div className="font-medium">{cmd.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {cmd.description}
                    </div>
                  </div>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {cmd.command.trim()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <PromptInput
        value={value}
        onValueChange={setValue}
        isLoading={streaming}
        onSubmit={handleSubmit}
        disabled={disabled}
        maxHeight={160}
      >
        <PromptInputTextarea
          dir={getTextDir(value) === "rtl" ? "rtl" : undefined}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled
              ? "Add sources to start chatting..."
              : 'Ask a question or type "/" for tools...'
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
