import type { SourceStatus } from "@/types/source";

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_BATCH_SIZE = 10;
export const MAX_NOTEBOOK_NAME_LENGTH = 100;
export const MAX_NOTEBOOK_DESC_LENGTH = 500;

/**
 * Map of file extension → MIME type for all supported upload types.
 */
export const SUPPORTED_FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  xml: "application/xml",
  json: "application/json",
  yaml: "application/x-yaml",
  jsonl: "application/jsonl",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  py: "text/x-python",
  js: "text/javascript",
  ts: "text/typescript",
  java: "text/x-java-source",
  c: "text/x-c",
  cpp: "text/x-c++src",
  cs: "text/x-csharp",
  go: "text/x-go",
  rb: "text/x-ruby",
  php: "text/x-php",
  sh: "text/x-shellscript",
  r: "text/x-r",
  sql: "text/x-sql",
};

export const SUPPORTED_EXTENSIONS = Object.keys(SUPPORTED_FILE_TYPES);

/**
 * Accept string for file input elements.
 */
export const FILE_INPUT_ACCEPT = SUPPORTED_EXTENSIONS.map(
  (ext) => `.${ext}`
).join(",");

/**
 * Status display configuration for sources.
 */
export const SOURCE_STATUS_CONFIG: Record<
  SourceStatus,
  { label: string; color: string; animation?: string }
> = {
  fetching: {
    label: "Fetching...",
    color: "bg-blue-100 text-blue-700",
    animation: "animate-pulse",
  },
  uploading: {
    label: "Uploading...",
    color: "bg-blue-100 text-blue-700",
    animation: "animate-pulse",
  },
  pending: {
    label: "Pending",
    color: "bg-yellow-100 text-yellow-700",
  },
  indexing: {
    label: "Indexing...",
    color: "bg-amber-100 text-amber-700",
  },
  ready: {
    label: "Ready",
    color: "bg-green-100 text-green-700",
  },
  failed: {
    label: "Failed",
    color: "bg-red-100 text-red-700",
  },
};

/**
 * Available Gemini models for chat.
 */
export const GEMINI_MODELS = [
  { id: "gemini-3-flash", label: "Gemini 3 Flash" },
  { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
] as const;

export const DEFAULT_MODEL_ID = "gemini-3-flash";

/**
 * Cloud Functions base URL.
 */
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
export const FUNCTIONS_BASE_URL = `https://us-central1-${PROJECT_ID}.cloudfunctions.net`;
export const CHAT_FUNCTION_URL = `${FUNCTIONS_BASE_URL}/chat`;
export const HEALTH_FUNCTION_URL = `${FUNCTIONS_BASE_URL}/health`;
export const PING_FUNCTION_URL = `${FUNCTIONS_BASE_URL}/ping`;

// System status warm-up
export const WARMUP_TIMEOUT_MS = 900;
export const WARM_THRESHOLD_MS = 200;

// Chat attachments (multimodal)
export const CHAT_ATTACHMENT_MAX_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_CHAT_ATTACHMENTS = 5;

export const CHAT_ATTACHMENT_TYPES: Record<string, string> = {
  // Images
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  // Audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  webm: "audio/webm",
  // PDF
  pdf: "application/pdf",
};

export const CHAT_ATTACHMENT_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "audio/*",
  ".pdf",
].join(",");
