import type { Timestamp } from "firebase/firestore";

export type SourceStatus =
  | "fetching"
  | "uploading"
  | "pending"
  | "indexing"
  | "ready"
  | "failed";

export type SourceType = "file" | "url";

export interface SourceTag {
  key: string;
  value: string;
}

export interface Source {
  id: string;
  notebookId: string;
  type: SourceType;
  displayName: string;
  originalUrl: string | null;
  storageRef: string;
  geminiDocId: string | null;
  fileType: string;
  sizeBytes: number | null;
  status: SourceStatus;
  failureReason: string | null;
  tags: SourceTag[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
