/**
 * Tiny dependency-free markdown-ish renderer for agent text + haiku summaries.
 * Supports: fenced code blocks, headings, bullet/numbered lists, paragraphs,
 * inline `code`, **bold**, *italic*, and [links](url). Intentionally tolerant —
 * anything it doesn't understand renders as plain text.
 */

import { Fragment, type ReactNode } from "react";

let keySeq = 0;
const k = () => `md-${keySeq++}`;

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // tokenize: `code` | **bold** | *italic* | [text](url)
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(
        <code
          key={k()}
          className="rounded bg-overlay px-1 py-px font-mono text-[0.92em] text-ember"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      out.push(
        <strong key={k()} className="font-semibold text-ink">
          {renderInline(tok.slice(2, -2))}
        </strong>,
      );
    } else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      if (lm && lm[1] && lm[2]) {
        out.push(
          <a
            key={k()}
            href={lm[2]}
            target="_blank"
            rel="noreferrer"
            className="text-queue underline decoration-queue/40 underline-offset-2 hover:decoration-queue"
          >
            {lm[1]}
          </a>,
        );
      } else {
        out.push(tok);
      }
    } else if (tok.startsWith("*")) {
      out.push(
        <em key={k()} className="italic">
          {renderInline(tok.slice(1, -1))}
        </em>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // fenced code block
    if (line.trimStart().startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith("```")) {
        code.push(lines[i] ?? "");
        i++;
      }
      i++; // closing fence
      blocks.push(
        <pre
          key={k()}
          className="my-2 overflow-x-auto rounded-md border border-edge bg-bg p-2.5 font-mono text-[11.5px] leading-relaxed text-mute"
        >
          {code.join("\n")}
        </pre>,
      );
      continue;
    }

    // heading
    const hm = /^(#{1,4})\s+(.*)$/.exec(line);
    if (hm && hm[1] && hm[2] !== undefined) {
      const level = hm[1].length;
      blocks.push(
        <p
          key={k()}
          className={
            level <= 2
              ? "mt-3 mb-1 text-[13px] font-semibold text-ink"
              : "mt-2 mb-0.5 text-[12px] font-semibold text-ink"
          }
        >
          {renderInline(hm[2])}
        </p>,
      );
      i++;
      continue;
    }

    // list block (bullets or numbered)
    if (/^\s*([-*•]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*([-*•]|\d+\.)\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={k()} className="my-1.5 space-y-1 pl-1">
          {items.map((item) => (
            <li key={k()} className="flex gap-2 leading-relaxed">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-faint" />
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // blank
    if (line.trim() === "") {
      i++;
      continue;
    }

    // paragraph: gather consecutive non-blank, non-special lines
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !/^\s*([-*•]|\d+\.)\s+/.test(lines[i] ?? "") &&
      !/^#{1,4}\s+/.test(lines[i] ?? "") &&
      !(lines[i] ?? "").trimStart().startsWith("```")
    ) {
      para.push(lines[i] ?? "");
      i++;
    }
    blocks.push(
      <p key={k()} className="my-1.5 leading-relaxed">
        {para.map((l, idx) => (
          <Fragment key={k()}>
            {idx > 0 ? " " : null}
            {renderInline(l)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className={className}>{blocks}</div>;
}
