import { useState, useCallback } from "react";
import { updateDoc, serverTimestamp } from "firebase/firestore";
import { getSourceRef } from "@/lib/firestore";
import {
  uploadBatch,
  deleteSource,
} from "../services/uploadService";

export function useFileUpload(notebookId: string, userId: string) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<Map<string, number>>(new Map());

  const startUpload = useCallback(
    async (
      files: File[],
      tags: Array<{ key: string; value: string }> = []
    ) => {
      if (files.length === 0) return;

      setUploading(true);
      setProgress(new Map());

      await uploadBatch(files, notebookId, userId, {
        onProgress: (sourceId, pct) => {
          setProgress((prev) => {
            const next = new Map(prev);
            next.set(sourceId, pct);
            return next;
          });
        },
        onComplete: (sourceId) => {
          setProgress((prev) => {
            const next = new Map(prev);
            next.delete(sourceId);
            return next;
          });
        },
        onError: (sourceId) => {
          setProgress((prev) => {
            const next = new Map(prev);
            next.delete(sourceId);
            return next;
          });
        },
      }, tags);

      setUploading(false);
    },
    [notebookId, userId]
  );

  const retrySource = useCallback(
    async (sourceId: string) => {
      try {
        await updateDoc(getSourceRef(notebookId, sourceId), {
          status: "pending",
          failureReason: null,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.error("Failed to retry source:", err);
      }
    },
    [notebookId]
  );

  const removeSource = useCallback(
    async (sourceId: string) => {
      try {
        await deleteSource(notebookId, sourceId);
      } catch (err) {
        console.error("Failed to delete source:", err);
      }
    },
    [notebookId]
  );

  const [removingAll, setRemovingAll] = useState(false);

  const removeAllSources = useCallback(
    async (sources: Array<{ id: string; status: string }>) => {
      setRemovingAll(true);
      try {
        const deletable = sources.filter(
          (s) => s.status === "ready" || s.status === "failed"
        );
        await Promise.all(
          deletable.map((s) => deleteSource(notebookId, s.id))
        );
      } catch (err) {
        console.error("Failed to delete all sources:", err);
      } finally {
        setRemovingAll(false);
      }
    },
    [notebookId]
  );

  return {
    uploading,
    progress,
    startUpload,
    retrySource,
    removeSource,
    removeAllSources,
    removingAll,
  };
}
