import {
  addDoc,
  updateDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  getNotebooksCollection,
  getNotebookRef,
  getSourcesCollection,
} from "@/lib/firestore";
import type { CreateNotebookInput } from "@/types/notebook";

export async function createNotebook(
  input: CreateNotebookInput,
  ownerId: string
): Promise<string> {
  const docRef = await addDoc(getNotebooksCollection(), {
    name: input.name.trim(),
    description: input.description.trim(),
    ownerId,
    lastOpenedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function touchNotebookLastOpened(
  notebookId: string
): Promise<void> {
  await updateDoc(getNotebookRef(notebookId), {
    lastOpenedAt: serverTimestamp(),
  });
}

export async function deleteNotebook(notebookId: string): Promise<void> {
  // Delete all sources in the subcollection first
  const sourcesSnapshot = await getDocs(getSourcesCollection(notebookId));
  const batch = writeBatch(db);

  sourcesSnapshot.docs.forEach((sourceDoc) => {
    batch.delete(sourceDoc.ref);
  });

  // Delete the notebook document
  batch.delete(getNotebookRef(notebookId));

  await batch.commit();
}
