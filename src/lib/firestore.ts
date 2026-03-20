import {
  collection,
  collectionGroup,
  doc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  type CollectionReference,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Notebook } from "@/types/notebook";
import type { Source } from "@/types/source";
import type { Session, Message } from "@/types/session";

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

// Session helpers
export function getSessionsCollection(notebookId: string): CollectionReference {
  return collection(db, "notebooks", notebookId, "sessions");
}

export function getActiveSessionQuery(notebookId: string): Query {
  return query(
    collection(db, "notebooks", notebookId, "sessions"),
    where("status", "==", "active"),
    limit(1)
  );
}

export function getSessionRef(
  notebookId: string,
  sessionId: string
): DocumentReference {
  return doc(db, "notebooks", notebookId, "sessions", sessionId);
}

export function getMessagesCollection(
  notebookId: string,
  sessionId: string
): CollectionReference {
  return collection(
    db,
    "notebooks",
    notebookId,
    "sessions",
    sessionId,
    "messages"
  );
}

export function getMessagesQuery(
  notebookId: string,
  sessionId: string
): Query {
  return query(
    collection(db, "notebooks", notebookId, "sessions", sessionId, "messages"),
    orderBy("createdAt", "asc")
  );
}

export function toSession(id: string, data: Record<string, unknown>): Session {
  return { id, ...data } as Session;
}

export function toMessage(id: string, data: Record<string, unknown>): Message {
  return { id, ...data } as Message;
}

// Archive helpers
export function getArchivedSessionsQuery(
  pageSize = 20,
  afterDoc?: DocumentSnapshot
): Query {
  const base = collectionGroup(db, "sessions");
  if (afterDoc) {
    return query(
      base,
      where("status", "==", "archived"),
      orderBy("archivedAt", "desc"),
      startAfter(afterDoc),
      limit(pageSize)
    );
  }
  return query(
    base,
    where("status", "==", "archived"),
    orderBy("archivedAt", "desc"),
    limit(pageSize)
  );
}
