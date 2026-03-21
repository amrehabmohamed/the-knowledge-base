import { useState, useRef, useEffect, useCallback } from "react";
import {
  ArrowUp,
  Square,
  Globe,
  MapPin,
  Link,
  Paperclip,
  X,
  FileText,
  Music,
  Mic,
} from "lucide-react";
import { getTextDir } from "@/lib/utils";
import {
  PromptInput,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import {
  CHAT_ATTACHMENT_ACCEPT,
  MAX_CHAT_ATTACHMENTS,
} from "@/config/constants";
import {
  validateAttachments,
  type AttachmentValidationError,
} from "@/features/chat/services/attachmentService";
import { formatFileSize } from "@/lib/formatters";

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
  onSend: (message: string, attachments?: File[]) => void;
  disabled: boolean;
  streaming: boolean;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ChatInput({ onSend, disabled, streaming }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [validationErrors, setValidationErrors] = useState<
    AttachmentValidationError[]
  >([]);
  const [recording, setRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Show menu when input is exactly "/" or starts with "/" and is filtering
  useEffect(() => {
    if (value === "/") {
      setShowMenu(true);
      setSelectedIndex(0);
    } else if (value.startsWith("/") && !value.includes(" ")) {
      const filtered = SLASH_COMMANDS.filter((cmd) =>
        cmd.command.trim().startsWith(value.toLowerCase())
      );
      setShowMenu(filtered.length > 0);
      setSelectedIndex(0);
    } else {
      setShowMenu(false);
    }
  }, [value]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

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
    if ((!trimmed && pendingFiles.length === 0) || disabled) return;
    onSend(trimmed, pendingFiles.length > 0 ? pendingFiles : undefined);
    setValue("");
    setPendingFiles([]);
    setValidationErrors([]);
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles = Array.from(files);
    const allFiles = [...pendingFiles, ...newFiles];

    const { valid, errors } = validateAttachments(allFiles);
    setPendingFiles(valid);
    setValidationErrors(errors);

    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
    setValidationErrors([]);
  };

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      chunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        // Stop all tracks to release mic
        stream.getTracks().forEach((t) => t.stop());

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const fileName = `recording-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.webm`;
        const file = new File([blob], fileName, { type: "audio/webm" });

        setPendingFiles((prev) => [...prev, file]);
        chunksRef.current = [];
      };

      mediaRecorder.start(250); // collect data every 250ms
      setRecording(true);
      setRecordingDuration(0);

      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch {
      setValidationErrors([
        { fileName: "Microphone", error: "Microphone access denied. Please allow microphone access in your browser." },
      ]);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
    setRecordingDuration(0);
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      // Remove the onstop handler so we don't add the file
      mediaRecorderRef.current.onstop = () => {
        // Stop tracks to release mic
        mediaRecorderRef.current?.stream
          ?.getTracks()
          .forEach((t) => t.stop());
      };
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    chunksRef.current = [];
    setRecording(false);
    setRecordingDuration(0);
  }, []);

  const getFilePreview = (file: File) => {
    if (file.type.startsWith("image/")) {
      return URL.createObjectURL(file);
    }
    return null;
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("audio/")) return Music;
    return FileText;
  };

  const canSend = (value.trim() || pendingFiles.length > 0) && !disabled;

  return (
    <div className="border-t px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-3 relative">
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

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div className="mb-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {validationErrors.map((err, i) => (
            <div key={i}>
              {err.fileName}: {err.error}
            </div>
          ))}
        </div>
      )}

      {/* Recording indicator */}
      {recording && (
        <div className="mb-2 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
          </span>
          <span className="text-sm font-medium text-red-700">
            Recording {formatDuration(recordingDuration)}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              onClick={cancelRecording}
              className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={stopRecording}
              className="rounded-md bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700 transition-colors"
            >
              Stop
            </button>
          </div>
        </div>
      )}

      {/* Pending file previews */}
      {pendingFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pendingFiles.map((file, index) => {
            const imageUrl = getFilePreview(file);
            const FileIcon = getFileIcon(file);

            return (
              <div
                key={`${file.name}-${index}`}
                className="group relative flex items-center gap-2 rounded-lg border bg-muted/50 px-2.5 py-1.5"
              >
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={file.name}
                    className="h-10 w-10 rounded object-cover"
                    onLoad={() => URL.revokeObjectURL(imageUrl)}
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded bg-muted">
                    <FileIcon className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="max-w-[120px]">
                  <div className="truncate text-xs font-medium">
                    {file.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {formatFileSize(file.size)}
                  </div>
                </div>
                <button
                  onClick={() => removeFile(index)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={CHAT_ATTACHMENT_ACCEPT}
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      <div className="flex items-end gap-1">
        {/* Attachment button — left side */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || recording}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground transition-colors sm:h-10 sm:w-10 ${disabled || recording ? "pointer-events-none opacity-40" : ""}`}
          title={`Attach files (max ${MAX_CHAT_ATTACHMENTS})`}
        >
          <Paperclip className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
        </button>

        {/* Text input — expands to fill */}
        <PromptInput
          value={value}
          onValueChange={setValue}
          isLoading={streaming}
          onSubmit={handleSubmit}
          disabled={disabled}
          maxHeight={120}
          className="min-w-0 flex-1 !rounded-2xl !p-1.5 sm:!rounded-3xl sm:!p-2"
        >
          <PromptInputTextarea
            dir={getTextDir(value) === "rtl" ? "rtl" : undefined}
            onKeyDown={handleKeyDown}
            className="!min-h-[36px] !text-[15px] sm:!min-h-[44px] sm:!text-sm"
            placeholder={
              disabled
                ? "Add sources to start chatting..."
                : 'Type a message...'
            }
          />
        </PromptInput>

        {/* Send / Mic button — right side, contextual like WhatsApp */}
        {canSend ? (
          <button
            onClick={handleSubmit}
            disabled={recording}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-colors sm:h-10 sm:w-10 ${recording ? "pointer-events-none opacity-40" : ""}`}
            title={streaming ? "Streaming..." : "Send message"}
          >
            {streaming ? (
              <Square className="h-3.5 w-3.5" />
            ) : (
              <ArrowUp className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
            )}
          </button>
        ) : (
          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={disabled && !recording}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors sm:h-10 sm:w-10 ${
              recording
                ? "bg-red-500 text-white animate-pulse"
                : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
            } ${disabled && !recording ? "pointer-events-none opacity-40" : ""}`}
            title={recording ? "Stop recording" : "Record audio"}
          >
            <Mic className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
