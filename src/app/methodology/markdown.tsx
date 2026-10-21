// A small Markdown renderer for docs/METHODOLOGY.md (headings, paragraphs,
// lists, tables, code spans, bold, links). No dependency; the document is ours.
import type { ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={k}>{inline(m[2], k)}</strong>);
    else
      out.push(
        <a key={k} href={m[4]} rel="noopener noreferrer">
          {m[3]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** Renders Markdown; `#` headings are shifted by `shift` levels (the page owns the h1). */
export function Markdown({ source, shift = 0 }: { source: string; shift?: number }) {
  const lines = source.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${n++}`;
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!line.trim()) {
      i++;
    } else if (h) {
      const level = Math.min(h[1].length + shift, 6);
      const Tag = `h${level}` as "h2";
      blocks.push(<Tag key={key}>{inline(h[2], key)}</Tag>);
      i++;
    } else if (line.trimStart().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={key}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
    } else if (line.trimStart().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("|")) {
        if (!/^\s*\|?\s*:?-+/.test(lines[i])) rows.push(cells(lines[i]));
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div className="table-wrap" key={key}>
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j} scope="col">
                    {inline(c, `${key}-h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j}>{inline(c, `${key}-${ri}-${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: { depth: number; text: string }[] = [];
      while (i < lines.length && lines[i].trim()) {
        const m = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (m) items.push({ depth: m[1].length, text: m[2] });
        else if (items.length) items[items.length - 1].text += ` ${lines[i].trim()}`;
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key}>
          {items.map((it, j) => (
            <li key={j} className={it.depth > 0 ? "md-nested" : undefined}>
              {inline(it.text, `${key}-${j}`)}
            </li>
          ))}
        </List>,
      );
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*\||\s*```|\s*(?:[-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++].trim());
      blocks.push(<p key={key}>{inline(para.join(" "), key)}</p>);
    }
  }
  return <>{blocks}</>;
}
