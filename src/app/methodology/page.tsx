import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { methodologyPage as copy, scoreWording, ui } from "@/lib/copy/wording";
import { paramRows, pct, pointRows, weightRows } from "@/lib/score/methodology";
import { Markdown } from "./markdown";

export const metadata: Metadata = { title: `${copy.title} — ${ui.appName}` };

/** The methodology document without its title line and without Section 7, which the tables above replace (same source). */
function documentBody(): string {
  const doc = readFileSync(join(process.cwd(), "docs", "METHODOLOGY.md"), "utf8");
  const withoutTitle = doc.replace(/^# .*\n/, "");
  return withoutTitle.replace(/^## 7\. Weights\n[\s\S]*?(?=^## )/m, "");
}

export default function MethodologyPage() {
  return (
    <>
      <h1>{copy.title}</h1>
      <p className="muted">{copy.intro}</p>

      <section aria-labelledby="weights-heading">
        <h2 id="weights-heading">{copy.weightsHeading}</h2>
        <div className="table-wrap">
          <table data-testid="axis-weights">
            <thead>
              <tr>
                <th scope="col">{copy.axisColumn}</th>
                <th scope="col">{copy.weightColumn}</th>
                <th scope="col">{copy.capColumn}</th>
              </tr>
            </thead>
            <tbody>
              {weightRows().map((r) => (
                <tr key={r.axis} data-axis={r.axis}>
                  <th scope="row">
                    {r.name} (<code>{r.axis}</code>)
                  </th>
                  <td data-testid={`weight-${r.axis}`}>{pct(r.weight)}</td>
                  <td>{r.cap}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="points-heading">
        <h2 id="points-heading">{copy.pointsHeading}</h2>
        <div className="table-wrap">
          <table data-testid="kind-points">
            <thead>
              <tr>
                <th scope="col">{copy.axisColumn}</th>
                <th scope="col">{copy.kindColumn}</th>
                <th scope="col">{copy.pointsColumn}</th>
              </tr>
            </thead>
            <tbody>
              {pointRows().map((r) => (
                <tr key={`${r.axis}-${r.kind}`}>
                  <td>{scoreWording.axisNames[r.axis]}</td>
                  <td>
                    <code>{r.kind}</code>
                  </td>
                  <td>{r.points === 0 ? copy.protective : r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="params-heading">
        <h2 id="params-heading">{copy.rulesHeading}</h2>
        <div className="table-wrap">
          <table data-testid="params">
            <tbody>
              {paramRows().map((r) => (
                <tr key={r.key}>
                  <th scope="row">
                    <code>{r.key}</code>
                  </th>
                  <td>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="doc-heading" data-testid="methodology-doc">
        <h2 id="doc-heading">{copy.documentHeading}</h2>
        <Markdown source={documentBody()} shift={1} />
      </section>
    </>
  );
}
