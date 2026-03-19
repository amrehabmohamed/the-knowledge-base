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
