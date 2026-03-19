import { useState, useEffect } from "react";
import { onSnapshot } from "firebase/firestore";
import { getSourcesQuery, toSource } from "@/lib/firestore";
import type { Source } from "@/types/source";

export function useSources(notebookId: string) {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!notebookId) {
      setSources([]);
      setLoading(false);
      return;
    }

    const q = getSourcesQuery(notebookId);
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((doc) =>
          toSource(doc.id, doc.data())
        );
        setSources(items);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [notebookId]);

  return { sources, loading, error };
}
