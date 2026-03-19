import type { Timestamp } from "firebase-admin/firestore";

export type SourceStatus =
  | "fetching"
  | "uploading"
  | "pending"
  | "indexing"
  | "ready"
  | "failed";

export type SourceType = "file" | "url";

export interface Source {
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
  tags: { key: string; value: string }[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Notebook {
  name: string;
  description: string;
  ownerId: string;
  lastOpenedAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
