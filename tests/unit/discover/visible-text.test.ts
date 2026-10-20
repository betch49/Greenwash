import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { countWords, visibleText } from "@/lib/discover/visible-text";
import { BRANDS, NORTHWIND } from "../helpers/brands";

describe("visibleText on fixture sustainability pages (2.3)", () => {
  it.each(BRANDS)("$slug: nav sentinel removed, wordCount > 100", (brand) => {
    const html = readFileSync(join("fixtures/brands", brand.slug, brand.sustainabilityPage), "utf8");
    // The sentinel really is in the page's site chrome…
    const $ = cheerio.load(html);
    $("script, style").remove();
    expect($("nav, header, footer").text()).toContain(brand.navSentinel);
    // …and is gone from the visible text.
    const vt = visibleText(html, brand.sustainabilityUrl);
    expect(vt.text).not.toContain(brand.navSentinel);
    expect(vt.wordCount).toBeGreaterThan(100);
    expect(vt.title).not.toBe("");
  });

  it.each([NORTHWIND])("$slug (fictional): nav sentinel removed", (brand) => {
    const html = readFileSync(join("fixtures/brands", brand.slug, brand.sustainabilityPage), "utf8");
    expect(visibleText(html, brand.sustainabilityUrl).text).not.toContain(brand.navSentinel);
  });

  it("drops the synthetic Northwind footer sentinel and keeps chrome links marked as such", () => {
    const brand = NORTHWIND;
    const html = readFileSync(join("fixtures/brands", brand.slug, brand.sustainabilityPage), "utf8");
    const vt = visibleText(html, brand.sustainabilityUrl);
    expect(vt.text).not.toContain("FOOTER SENTINEL 9B2C");
    expect(vt.text).toContain("We are carbon neutral.");
    const report = vt.links.filter((l) => l.href === "https://www.northwind-outdoor.example/media/impact-report-2025.pdf");
    expect(report.map((l) => l.region).sort()).toEqual(["chrome", "content"]);
  });
});

describe("visibleText rules", () => {
  const html = `<!doctype html><html><head><title> My  page </title><style>.x{color:red}</style>
    <script>var secret = "SCRIPT TEXT";</script></head><body>
    <header><a href="/">Logo</a></header>
    <nav><a href="/shop">Shop NAVTEXT</a></nav>
    <main>
      <h1>Our   planet</h1>
      <p>First paragraph with <a href="report.pdf">our report</a> inside.</p>
      <p hidden>Hidden paragraph</p>
      <div aria-hidden="true">Decorative</div>
      <ul><li>One</li><li>Two</li></ul>
      <noscript>Enable JS</noscript>
      <a href="mailto:x@y.z">Mail</a> <a href="#top">Top</a>
    </main>
    <aside>Sidebar ASIDETEXT</aside>
    <footer>Footer FOOTERTEXT <a href="https://other.example/x#frag">Other</a></footer>
  </body></html>`;
  const vt = visibleText(html, "https://brand.example/about/");

  it("strips script, style, noscript, hidden elements and chrome", () => {
    for (const gone of ["SCRIPT TEXT", "color:red", "NAVTEXT", "ASIDETEXT", "FOOTERTEXT", "Logo", "Hidden paragraph", "Decorative", "Enable JS"]) {
      expect(vt.text).not.toContain(gone);
    }
  });

  it("keeps headings, paragraphs and list items as separate lines, whitespace collapsed", () => {
    expect(vt.text.split("\n")).toEqual(["Our planet", "First paragraph with our report inside.", "One", "Two", "Mail Top"]);
    expect(vt.title).toBe("My page");
    expect(vt.wordCount).toBe(countWords(vt.text));
  });

  it("returns absolute http(s) links with their region, without fragments", () => {
    expect(vt.links).toEqual([
      { href: "https://brand.example/", text: "Logo", region: "chrome" },
      { href: "https://brand.example/shop", text: "Shop NAVTEXT", region: "chrome" },
      { href: "https://brand.example/about/report.pdf", text: "our report", region: "content" },
      { href: "https://other.example/x", text: "Other", region: "chrome" },
    ]);
  });

  it("counts words that contain a letter or digit", () => {
    expect(countWords("Hello — world 2030 , ok")).toBe(4);
    expect(countWords("")).toBe(0);
  });
});
