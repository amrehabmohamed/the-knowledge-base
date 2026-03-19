import { useState, useEffect } from "react";
import { onSnapshot } from "firebase/firestore";
import { getNotebooksQuery, toNotebook } from "@/lib/firestore";
import { useAuthContext } from "@/features/auth";
import type { Notebook } from "@/types/notebook";

export function useNotebooks() {
  const { user } = useAuthContext();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!user) {
      setNotebooks([]);
      setLoading(false);
      return;
    }

    const q = getNotebooksQuery(user.uid);
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((doc) =>
          toNotebook(doc.id, doc.data())
        );
        setNotebooks(items);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [user]);

  return { notebooks, loading, error };
}
