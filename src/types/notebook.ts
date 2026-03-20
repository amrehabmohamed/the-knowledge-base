import type { Timestamp } from "firebase/firestore";

export interface Notebook {
  id: string;
  name: string;
  description: string;
  systemPrompt?: string;
  ownerId: string;
  lastOpenedAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateNotebookInput {
  name: string;
  description: string;
}
