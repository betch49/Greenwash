// Resolves the website and display name for a URL-fallback run (QA fix round):
// the name comes from the fetched homepage (og:site_name or <title>), falling
// back to the domain; a bare domain that cannot be fetched is retried with www.
import type { Fetcher } from "./fetch/fetcher";
import { displayHost, siteNameFromHtml, withWww } from "./website";

export interface ResolvedSite {
  website: string;
  name: string;
}

async function tryFetch(fetcher: Fetcher, url: string): Promise<string | null> {
  try {
    const res = await fetcher.get(url);
    return res.status >= 200 && res.status < 400 ? res.body : null;
  } catch {
    return null;
  }
}

export async function resolveSite(fetcher: Fetcher, website: string): Promise<ResolvedSite> {
  let html = await tryFetch(fetcher, website);
  let site = website;
  if (html === null) {
    const www = withWww(website);
    if (www) {
      const h = await tryFetch(fetcher, www);
      if (h !== null) {
        html = h;
        site = www;
      }
    }
  }
  return { website: site, name: (html && siteNameFromHtml(html)) || displayHost(site) };
}
