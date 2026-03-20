import { useState, useEffect } from "react";
import { getDoc, getDocs } from "firebase/firestore";
import {
  getSessionRef,
  getNotebookRef,
  getMessagesQuery,
  toSession,
  toMessage,
} from "@/lib/firestore";
import type { Session, Message } from "@/types/session";

export function useArchivedSession(notebookId: string, sessionId: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notebookName, setNotebookName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!notebookId || !sessionId) return;

    async function load() {
      setLoading(true);
      try {
        const [sessionSnap, notebookSnap, messagesSnap] = await Promise.all([
          getDoc(getSessionRef(notebookId, sessionId)),
          getDoc(getNotebookRef(notebookId)),
          getDocs(getMessagesQuery(notebookId, sessionId)),
        ]);

        if (sessionSnap.exists()) {
          setSession(
            toSession(sessionSnap.id, sessionSnap.data() as Record<string, unknown>)
          );
        }

        setNotebookName(
          notebookSnap.exists()
            ? (notebookSnap.data().name as string) ?? "Untitled"
            : "Deleted Notebook"
        );

        setMessages(
          messagesSnap.docs.map((d) =>
            toMessage(d.id, d.data() as Record<string, unknown>)
          )
        );
      } catch (err) {
        console.error("Failed to load archived session:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [notebookId, sessionId]);

  return { session, messages, notebookName, loading };
}
