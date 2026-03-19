import { useState, useEffect } from "react";
import { onSnapshot } from "firebase/firestore";
import { getMessagesQuery, toMessage } from "@/lib/firestore";
import type { Message } from "@/types/session";

export function useMessages(
  notebookId: string,
  sessionId: string | undefined
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!notebookId || !sessionId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const q = getMessagesQuery(notebookId, sessionId);
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((doc) =>
          toMessage(doc.id, doc.data())
        );
        setMessages(items);
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [notebookId, sessionId]);

  return { messages, loading };
}
