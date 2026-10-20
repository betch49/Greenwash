import * as cheerio from "cheerio";

export interface PageLink {
  /** Absolute URL (resolved against the page URL when one is given). */
  href: string;
  text: string;
  /** "content" = main page body; "chrome" = inside nav/header/footer/aside (stripped from `text`). */
  region: "content" | "chrome";
}

export interface VisibleText {
  title: string;
  /** Visible body text, one block (heading, paragraph, list item…) per line. */
  text: string;
  wordCount: number;
  links: PageLink[];
}

/** Never visible. */
const JUNK = "script, style, noscript, template, svg, iframe, object, embed, canvas, select, [hidden], [aria-hidden='true']";
/** Site chrome: navigation, header, footer, sidebars. Stripped from the text (brief Section 5). */
const CHROME =
  "nav, header, footer, aside, [role='navigation'], [role='banner'], [role='contentinfo'], [role='complementary']";

const BLOCK = new Set([
  "address", "article", "blockquote", "br", "caption", "dd", "details", "dialog", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "form", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "main",
  "ol", "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
  "body", "html",
]);

/** Minimal structural view of a domhandler node (avoids a direct dependency on domhandler). */
interface DomNode {
  type: string;
  name?: string;
  data?: string;
  children?: DomNode[];
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Counts words: whitespace-separated tokens containing at least one letter or digit. */
export function countWords(text: string): number {
  let n = 0;
  for (const token of text.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(token)) n++;
  return n;
}

function resolveHref(href: string, baseUrl?: string): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(raw)) return null;
  try {
    const u = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Extracts the visible text of an HTML page: drops scripts, styles, hidden
 * elements and site chrome (nav/header/footer/aside), keeps headings,
 * paragraphs and list items as separate lines, collapses whitespace.
 */
export function visibleText(html: string, baseUrl?: string): VisibleText {
  const $ = cheerio.load(html);
  const title = collapse($("title").first().text());
  $(JUNK).remove();

  const links: PageLink[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = resolveHref($(el).attr("href") ?? "", baseUrl);
    const text = collapse($(el).text()) || collapse($(el).attr("aria-label") ?? "") || collapse($(el).attr("title") ?? "");
    if (!href) return;
    const region = $(el).closest(CHROME).length > 0 ? "chrome" : "content";
    const key = `${region} ${href} ${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ href, text, region });
  });

  $(CHROME).remove();

  const lines: string[] = [];
  let buf = "";
  const flush = () => {
    const line = collapse(buf);
    if (line) lines.push(line);
    buf = "";
  };
  const walk = (node: DomNode) => {
    if (node.type === "text") {
      buf += node.data ?? "";
      return;
    }
    if (node.type !== "tag" && node.type !== "root") return;
    const block = node.name ? BLOCK.has(node.name) : false;
    if (block) flush();
    for (const child of node.children ?? []) walk(child);
    if (block) flush();
  };
  const root = ($("body").get(0) ?? $.root().get(0)) as unknown as DomNode | undefined;
  if (root) walk(root);
  flush();

  const text = lines.join("\n");
  return { title, text, wordCount: countWords(text), links };
}
