import type { FetchResult, Fetcher } from "@/lib/fetch/fetcher";

/** In-memory fetcher: URL ⇒ body (200, content type by extension); anything else ⇒ 404. */
export class MapFetcher implements Fetcher {
  readonly calls: string[] = [];
  constructor(private readonly files: Record<string, string>) {}

  async get(url: string): Promise<FetchResult> {
    this.calls.push(url);
    const body = this.files[url];
    const path = new URL(url).pathname;
    const contentType = path.endsWith(".xml") ? "application/xml" : path.endsWith(".txt") ? "text/plain" : "text/html; charset=utf-8";
    return {
      url,
      status: body === undefined ? 404 : 200,
      body: body ?? "",
      contentType,
      fetchedAt: "2026-01-01T00:00:00.000Z",
      source: "fixture",
    };
  }
}

/** A page with enough visible words to be kept by fetchPages. */
export const htmlPage = (title: string, words = 80) =>
  `<html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${Array.from({ length: words }, (_, i) => `word${i}`).join(" ")}</p></main></body></html>`;
