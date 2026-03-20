import { useState, useEffect, useCallback, useRef } from "react";
import { getDocs, getDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getArchivedSessionsQuery, toSession } from "@/lib/firestore";
import type { Session } from "@/types/session";
import type { DocumentSnapshot } from "firebase/firestore";

export interface ArchivedSessionItem {
  session: Session;
  notebookName: string;
}

export function useArchive() {
  const [items, setItems] = useState<ArchivedSessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const lastDocRef = useRef<DocumentSnapshot | undefined>(undefined);
  const notebookNameCache = useRef<Map<string, string>>(new Map());

  const fetchNotebookName = useCallback(
    async (notebookId: string): Promise<string> => {
      const cached = notebookNameCache.current.get(notebookId);
      if (cached !== undefined) return cached;

      try {
        const snap = await getDoc(doc(db, "notebooks", notebookId));
        const name = snap.exists()
          ? (snap.data().name as string) ?? "Untitled"
          : "Deleted Notebook";
        notebookNameCache.current.set(notebookId, name);
        return name;
      } catch {
        return "Unknown Notebook";
      }
    },
    []
  );

  const loadPage = useCallback(
    async (afterDoc?: DocumentSnapshot) => {
      setLoading(true);
      try {
        const q = getArchivedSessionsQuery(20, afterDoc);
        const snap = await getDocs(q);

        const newItems: ArchivedSessionItem[] = await Promise.all(
          snap.docs.map(async (d) => {
            const session = toSession(d.id, d.data() as Record<string, unknown>);
            const notebookName = await fetchNotebookName(session.notebookId);
            return { session, notebookName };
          })
        );

        if (afterDoc) {
          setItems((prev) => [...prev, ...newItems]);
        } else {
          setItems(newItems);
        }

        lastDocRef.current = snap.docs[snap.docs.length - 1];
        setHasMore(snap.docs.length === 20);
      } catch (err) {
        console.error("Failed to load archive:", err);
      } finally {
        setLoading(false);
      }
    },
    [fetchNotebookName]
  );

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  const loadMore = useCallback(() => {
    if (lastDocRef.current) {
      loadPage(lastDocRef.current);
    }
  }, [loadPage]);

  return { items, loading, hasMore, loadMore };
}
