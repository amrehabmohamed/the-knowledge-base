import { useState, useCallback } from "react";
import { validateUrl, ingestUrl } from "../services/urlService";

export function useUrlIngest(notebookId: string) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submitUrl = useCallback(
    async (url: string, existingUrls: string[]) => {
      setError("");

      const validationError = validateUrl(url, existingUrls);
      if (validationError) {
        setError(validationError);
        return false;
      }

      setSubmitting(true);
      try {
        const result = await ingestUrl(notebookId, url);
        if (!result.success && result.error) {
          setError(result.error);
          return false;
        }
        return true;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to add URL.";
        setError(message);
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [notebookId]
  );

  const clearError = useCallback(() => setError(""), []);

  return { submitting, error, submitUrl, clearError };
}
