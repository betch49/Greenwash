/** Normalises a user-pasted website ("example.com", "https://www.example.com/x") or returns null. */
export function normaliseWebsite(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return null;
  if (u.username || u.password) return null;
  return `${u.protocol}//${u.host}${u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "")}`;
}

export function displayHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Longest display name derived from a homepage (QA fix: headings stay readable). */
export const MAX_SITE_NAME = 80;

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/**
 * The brand's display name from its homepage HTML: og:site_name, else the
 * <title> (first segment before " | ", " - ", " – ", " — "), cleaned. Null when neither is usable.
 */
export function siteNameFromHtml(html: string): string | null {
  const og =
    /<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:site_name["']/i.exec(html)?.[1];
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  for (const raw of [og, title ? title.split(/\s+[|\-–—:·]\s+/)[0] : undefined]) {
    if (!raw) continue;
    const clean = decodeEntities(raw).replace(/\s+/g, " ").trim();
    if (clean.length >= 2) return clean.slice(0, MAX_SITE_NAME);
  }
  return null;
}

/** Adds "www." to a bare-domain URL; null when it already has www. or a subdomain. */
export function withWww(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.startsWith("www.") || u.hostname.split(".").length !== 2) return null;
    return `${u.protocol}//www.${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return null;
  }
}

/** True when the text looks like a website address rather than a brand name ("acme.com", "https://…"). */
export function looksLikeUrl(input: string): boolean {
  const s = input.trim();
  if (!s || /\s/.test(s)) return false;
  if (/^https?:\/\//i.test(s) || /^www\./i.test(s)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(s);
}

/** Longest accepted search query (QA fix: input maxlength and server-side cap). */
export const MAX_QUERY = 100;
export const capQuery = (q: string) => q.trim().slice(0, MAX_QUERY);
/** Truncates a long string for a heading. */
export const truncate = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
