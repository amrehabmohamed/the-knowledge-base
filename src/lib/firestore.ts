import {
  collection,
  doc,
  query,
  where,
  orderBy,
  type CollectionReference,
  type DocumentReference,
  type Query,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Notebook } from "@/types/notebook";
import type { Source } from "@/types/source";

export function getNotebooksCollection(): CollectionReference {
  return collection(db, "notebooks");
}

export function getNotebooksQuery(ownerId: string): Query {
  return query(
    collection(db, "notebooks"),
    where("ownerId", "==", ownerId),
    orderBy("lastOpenedAt", "desc")
  );
}

export function getNotebookRef(notebookId: string): DocumentReference {
  return doc(db, "notebooks", notebookId);
}

export function getSourcesCollection(notebookId: string): CollectionReference {
  return collection(db, "notebooks", notebookId, "sources");
}

export function getSourceRef(
  notebookId: string,
  sourceId: string
): DocumentReference {
  return doc(db, "notebooks", notebookId, "sources", sourceId);
}

export function getSourcesQuery(notebookId: string): Query {
  return query(
    collection(db, "notebooks", notebookId, "sources"),
    orderBy("createdAt", "desc")
  );
}

// Type helpers for Firestore snapshot conversion
export function toNotebook(id: string, data: Record<string, unknown>): Notebook {
  return { id, ...data } as Notebook;
}

export function toSource(id: string, data: Record<string, unknown>): Source {
  return { id, ...data } as Source;
}
