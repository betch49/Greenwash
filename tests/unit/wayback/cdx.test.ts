import { describe, expect, it } from "vitest";
import { cdxUrl, listSnapshots, parseCdx, pickYearly, waybackIntervalMs, yearWindow, CdxParseError, WaybackUnavailableError } from "@/lib/wayback/cdx";
import { MapFetcher } from "../helpers/map-fetcher";

const NOW = new Date("2026-10-20T12:00:00Z");
const PAGE = "https://www.northwind-outdoor.example/our-footprint/";

const HEADER = ["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"];
const row = (ts: string, status = "200") => ["example,northwind-outdoor)/our-footprint", ts, PAGE, "text/html", status, "D", "1"];

describe("CDX query (4.1)", () => {
  it("builds the URL exactly as the brief specifies, with from=<year-8>", () => {
    expect(cdxUrl(PAGE, NOW)).toBe(
      "https://web.archive.org/cdx/search/cdx?url=https%3A%2F%2Fwww.northwind-outdoor.example%2Four-footprint%2F&output=json&filter=statuscode:200&collapse=timestamp:4&from=2018",
    );
    // The page's own query string cannot leak into the CDX parameters.
    expect(cdxUrl("https://a.example/p?x=1&output=xml", NOW)).toContain("url=https%3A%2F%2Fa.example%2Fp%3Fx%3D1%26output%3Dxml&output=json");
  });

  it("the year window is the last 8 calendar years, ending with the current one", () => {
    expect(yearWindow(NOW)).toEqual({ from: 2019, to: 2026 });
  });

  it("parses the header row + data rows format", () => {
    const rows = parseCdx(JSON.stringify([HEADER, row("20210315141503"), row("20240902080044")]));
    expect(rows).toEqual([
      { timestamp: "20210315141503", original: PAGE, statuscode: "200", mimetype: "text/html" },
      { timestamp: "20240902080044", original: PAGE, statuscode: "200", mimetype: "text/html" },
    ]);
  });

  it("reads columns by header name, not position", () => {
    const rows = parseCdx(JSON.stringify([["original", "timestamp"], [PAGE, "20230101000000"]]));
    expect(rows).toEqual([{ timestamp: "20230101000000", original: PAGE, statuscode: "", mimetype: "" }]);
  });

  it("an empty answer means no captures; malformed rows are dropped; non-JSON throws", () => {
    expect(parseCdx("[]")).toEqual([]);
    expect(parseCdx("")).toEqual([]);
    expect(parseCdx(JSON.stringify([HEADER, ["x", "2021", PAGE], "junk", row("20210101000000")]))).toHaveLength(1);
    expect(() => parseCdx("<html>maintenance</html>")).toThrow(CdxParseError);
    expect(() => parseCdx(JSON.stringify({ a: 1 }))).toThrow(CdxParseError);
  });

  it("picks one snapshot per year, the newest of each year, oldest year first, inside the window", () => {
    const rows = parseCdx(
      JSON.stringify([
        HEADER,
        row("20170101000000"), // before the window
        row("20180101000000"), // before the window (from=2018 is asked, but 8 years end in 2026)
        row("20210315141503"),
        row("20211230235959"),
        row("20210701000000"),
        row("20230505050505", "301"),
        row("20240902080044"),
      ]),
    );
    const picked = pickYearly(rows, NOW);
    expect(picked.map((p) => p.timestamp)).toEqual(["20211230235959", "20240902080044"]);
    expect(picked[0]).toMatchObject({ year: 2021, date: "2021-12-30" });
  });

  it("listSnapshots fetches the CDX URL and returns the yearly picks", async () => {
    const f = new MapFetcher({ [cdxUrl(PAGE, NOW)]: JSON.stringify([HEADER, row("20200611093012"), row("20250410172230")]) });
    const list = await listSnapshots(PAGE, f, NOW);
    expect(f.calls).toEqual([cdxUrl(PAGE, NOW)]);
    expect(list.status).toBe(200);
    expect(list.snapshots.map((s) => s.year)).toEqual([2020, 2025]);
  });

  it("listSnapshots: 429, 5xx, a thrown error or a non-JSON 200 ⇒ WaybackUnavailableError; 404 ⇒ status returned", async () => {
    const status = (s: number, body = "") => ({ get: async (url: string) => ({ url, status: s, body, contentType: "text/html", fetchedAt: NOW.toISOString(), source: "network" as const }) });
    await expect(listSnapshots(PAGE, status(429), NOW)).rejects.toThrow("Wayback unreachable (HTTP 429)");
    await expect(listSnapshots(PAGE, status(503), NOW)).rejects.toBeInstanceOf(WaybackUnavailableError);
    await expect(listSnapshots(PAGE, status(200, "<html>down</html>"), NOW)).rejects.toBeInstanceOf(WaybackUnavailableError);
    await expect(listSnapshots(PAGE, { get: async () => Promise.reject(new Error("read ECONNRESET")) }, NOW)).rejects.toThrow(
      "Wayback unreachable (read ECONNRESET)",
    );
    expect(await listSnapshots(PAGE, status(404), NOW)).toMatchObject({ status: 404, snapshots: [] });
  });

  it("WAYBACK_RATE_LIMIT_MS can raise the spacing but never lower it below 1000 ms", () => {
    expect(waybackIntervalMs({})).toBe(1000);
    expect(waybackIntervalMs({ WAYBACK_RATE_LIMIT_MS: "100" })).toBe(1000);
    expect(waybackIntervalMs({ WAYBACK_RATE_LIMIT_MS: "2500" })).toBe(2500);
    expect(waybackIntervalMs({ WAYBACK_RATE_LIMIT_MS: "fast" })).toBe(1000);
  });
});
