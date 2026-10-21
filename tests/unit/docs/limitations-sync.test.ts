// Criterion 9.4: docs/LIMITATIONS.md lists every "skipped: <reason>" template in
// src/lib/copy/wording.ts (`reasons`), rendered with each parameter shown as
// <name>, plus the robots.txt reason that lives with its error class.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reasons, skippedReason } from "@/lib/copy/wording";
import { RobotsDisallowedError } from "@/lib/fetch/robots";

/** Renders a template with placeholders: (url, status) => `HTTP ${status} for ${url}` ⇒ "HTTP <status> for <url>". */
export function renderTemplate(t: string | ((...a: string[]) => string)): string {
  if (typeof t === "string") return t;
  const m = /^\s*(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/.exec(t.toString());
  if (!m) throw new Error(`cannot read the parameters of ${t.toString()}`);
  const names = (m[1] ?? m[2] ?? "")
    .split(",")
    .map((s) => s.split(":")[0].split("=")[0].trim())
    .filter(Boolean);
  return t(...names.map((n) => `<${n}>`));
}

export function skippedTemplates(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, t] of Object.entries(reasons)) out[key] = skippedReason(renderTemplate(t as string | ((...a: string[]) => string)));
  out.robotsDisallowed = skippedReason(new RobotsDisallowedError("<url>").message);
  return out;
}

describe("LIMITATIONS lists every skipped reason (9.4)", () => {
  const doc = readFileSync(join(process.cwd(), "docs", "LIMITATIONS.md"), "utf8");
  const templates = skippedTemplates();

  it("extracts every reason template from wording.ts", () => {
    expect(Object.keys(templates).length).toBe(Object.keys(reasons).length + 1);
    expect(templates.httpStatus).toBe("skipped: HTTP <status> for <url>");
    for (const t of Object.values(templates)) expect(t).not.toMatch(/undefined|\$\{/);
  });

  it.each(Object.entries(templates))("%s is listed verbatim", (_key, line) => {
    expect(doc).toContain(`\`${line}\``);
  });
});
