import { extractUrl } from "./jina";

/** Hard caps to keep context bounded and latency predictable. */
const MAX_URLS = 3;
const MAX_CHARS_PER_URL = 8000;

const URL_REGEX = /https?:\/\/[^\s<>"'\)\]]+/g;

export interface PrefetchedUrl {
  url: string;
  ok: boolean;
  title?: string;
  markdown?: string;
  error?: string;
}

/** Returns up to MAX_URLS de-duplicated URLs from the text, in order. */
export function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX) ?? [];
  // Strip common trailing punctuation that regex tends to absorb.
  const cleaned = matches.map((u) => u.replace(/[.,;:!?]+$/, ""));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of cleaned) {
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
      if (out.length >= MAX_URLS) break;
    }
  }
  return out;
}

/** Fetches each URL via Jina Reader in parallel. Always resolves — failures
 *  are returned as `{ ok: false, error }` so callers can fail soft. */
export async function prefetchUrls(urls: string[]): Promise<PrefetchedUrl[]> {
  if (urls.length === 0) return [];
  return Promise.all(
    urls.map(async (url): Promise<PrefetchedUrl> => {
      try {
        const { title, markdown } = await extractUrl(url);
        const truncated =
          markdown.length > MAX_CHARS_PER_URL
            ? markdown.slice(0, MAX_CHARS_PER_URL) + "\n\n[…truncated…]"
            : markdown;
        return { url, ok: true, title, markdown: truncated };
      } catch (err) {
        const error = err instanceof Error ? err.message : "fetch failed";
        return { url, ok: false, error };
      }
    })
  );
}

/** Renders successful prefetched URLs as a single context block to inject
 *  before the user's query. Returns null if nothing to inject. */
export function renderPrefetchBlock(results: PrefetchedUrl[]): string | null {
  const ok = results.filter((r) => r.ok && r.markdown);
  if (ok.length === 0) return null;
  const parts = ok.map(
    (r) =>
      `[Pre-fetched URL: ${r.url}${r.title ? ` — ${r.title}` : ""}]\n${r.markdown}\n[End of ${r.url}]`
  );
  return [
    "The user shared one or more URLs. Their content has been pre-fetched and is included below for your reference. Treat each as a citable source. If the user's actual question is not about these URLs, you may ignore them.",
    "",
    parts.join("\n\n"),
  ].join("\n");
}
