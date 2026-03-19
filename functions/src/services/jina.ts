import { getJinaApiKey } from "../config";

interface JinaResult {
  title: string;
  markdown: string;
}

const ERROR_MESSAGES: Record<number, string> = {
  422: "This page requires login or a subscription. Only publicly accessible pages are supported.",
  429: "Too many requests. Please try again in a moment.",
  503: "URL processing service is temporarily unavailable. Please try again shortly.",
};

const MAX_CONTENT_SIZE = 50 * 1024 * 1024; // 50 MB

export async function extractUrl(url: string): Promise<JinaResult> {
  const apiKey = getJinaApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "X-Return-Format": "markdown",
      },
      signal: controller.signal,
    });

    // Handle non-200 status codes
    if (!response.ok) {
      const message =
        ERROR_MESSAGES[response.status] ??
        `Failed to fetch URL (HTTP ${response.status}).`;
      throw new Error(message);
    }

    const data = await response.json();
    const content: string = data?.data?.content ?? "";
    const warning: string = data?.data?.warning ?? "";
    const title: string = data?.data?.title ?? "";

    // Check warnings for embedded error codes
    if (warning.includes("returned error 404")) {
      throw new Error("Page not found. Check the URL and try again.");
    }
    if (warning.includes("returned error 403")) {
      throw new Error(
        "This page could not be accessed. It may be blocked or behind a firewall."
      );
    }

    // Check for empty or minimal content
    if (!content || content.trim().length < 50) {
      throw new Error(
        "No readable content could be extracted from this page."
      );
    }

    // Check content size
    const contentBytes = Buffer.byteLength(content, "utf-8");
    if (contentBytes > MAX_CONTENT_SIZE) {
      throw new Error(
        "The extracted content from this URL exceeds the file size limit."
      );
    }

    return {
      title: title || url,
      markdown: content,
    };
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.name === "AbortError") {
        throw new Error(
          "The page took too long to load. Try again or use a different URL."
        );
      }
      throw err;
    }
    throw new Error("An unexpected error occurred while fetching the URL.");
  } finally {
    clearTimeout(timeout);
  }
}
