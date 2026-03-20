import { useState, useEffect, useCallback } from "react";
import {
  addDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import {
  getSessionsCollection,
  getActiveSessionQuery,
  getSessionRef,
  toSession,
} from "@/lib/firestore";
import { DEFAULT_MODEL_ID } from "@/config/constants";
import type { Session } from "@/types/session";

export function useSession(notebookId: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!notebookId) {
      setLoading(false);
      return;
    }

    const q = getActiveSessionQuery(notebookId);
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      if (snapshot.empty) {
        // No active session — create one
        try {
          await addDoc(getSessionsCollection(notebookId), {
            notebookId,
            status: "active",
            totalTokens: 0,
            messageCount: 0,
            modelId: DEFAULT_MODEL_ID,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            archivedAt: null,
          });
        } catch (err) {
          console.error("Failed to create session:", err);
        }
        // The onSnapshot will fire again with the new session
      } else {
        const doc = snapshot.docs[0];
        setSession(toSession(doc.id, doc.data()));
        setLoading(false);
      }
    });

    return unsubscribe;
  }, [notebookId]);

  const archiveSession = useCallback(async () => {
    if (!session) return;
    await updateDoc(getSessionRef(notebookId, session.id), {
      status: "archived",
      archivedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }, [notebookId, session]);

  const createSession = useCallback(
    async (modelId?: string) => {
      await addDoc(getSessionsCollection(notebookId), {
        notebookId,
        status: "active",
        totalTokens: 0,
        messageCount: 0,
        modelId: modelId ?? DEFAULT_MODEL_ID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        archivedAt: null,
      });
    },
    [notebookId]
  );

  const updateModel = useCallback(
    async (modelId: string) => {
      if (!session) return;
      await updateDoc(getSessionRef(notebookId, session.id), {
        modelId,
        updatedAt: serverTimestamp(),
      });
    },
    [notebookId, session]
  );

  return { session, loading, archiveSession, createSession, updateModel };
}
