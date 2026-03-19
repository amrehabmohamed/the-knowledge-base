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
    async (sourceId: string, storageRef: string | null) => {
      try {
        await deleteSource(notebookId, sourceId, storageRef);
      } catch (err) {
        console.error("Failed to delete source:", err);
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
  };
}
