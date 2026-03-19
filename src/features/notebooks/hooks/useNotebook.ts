import { useState, useEffect } from "react";
import { onSnapshot } from "firebase/firestore";
import { getNotebookRef, toNotebook } from "@/lib/firestore";
import { touchNotebookLastOpened } from "../services/notebookService";
import type { Notebook } from "@/types/notebook";

export function useNotebook(notebookId: string | undefined) {
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!notebookId) {
      setLoading(false);
      return;
    }

    // Touch lastOpenedAt when opening a notebook
    touchNotebookLastOpened(notebookId).catch(() => {
      // Non-critical, ignore errors
    });

    const ref = getNotebookRef(notebookId);
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        if (snapshot.exists()) {
          setNotebook(toNotebook(snapshot.id, snapshot.data()));
        } else {
          setNotebook(null);
        }
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [notebookId]);

  return { notebook, loading, error };
}
