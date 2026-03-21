import type { Timestamp } from "firebase/firestore";

export interface NotebookTools {
  googleSearch?: boolean;
  urlContext?: boolean;
  googleMaps?: boolean;
}

export interface Notebook {
  id: string;
  name: string;
  description: string;
  systemPrompt?: string;
  tools?: NotebookTools;
  ownerId: string;
  lastOpenedAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateNotebookInput {
  name: string;
  description: string;
}
