import { callFunction } from "@/lib/api";

export function validateUrl(
  url: string,
  existingUrls: string[]
): string | null {
  if (!url.trim()) {
    return "URL is required.";
  }

  try {
    new URL(url);
  } catch {
    return "Please enter a valid URL.";
  }

  if (existingUrls.includes(url.trim())) {
    return "This URL has already been added to this notebook.";
  }

  return null;
}

export async function ingestUrl(
  notebookId: string,
  url: string
): Promise<{ success: boolean; error?: string }> {
  return callFunction<{ success: boolean; error?: string }>("ingestUrl", {
    notebookId,
    url: url.trim(),
  });
}
