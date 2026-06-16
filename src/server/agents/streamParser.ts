/**
 * Line-buffered NDJSON parsing over a child process stdout.
 *
 * Agent CLIs (claude --output-format stream-json, codex exec --json) emit one
 * JSON object per line, but stdout 'data' chunks split lines arbitrarily — a
 * carry buffer holds the trailing partial line between chunks. Non-JSON lines
 * (warnings, banners) are tolerated and surfaced via onNonJson.
 */

export class LineBuffer {
  private carry = "";

  /** Feed a chunk; returns the COMPLETE lines it terminated (without \n). */
  push(chunk: string | Buffer): string[] {
    this.carry += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const parts = this.carry.split("\n");
    this.carry = parts.pop() ?? "";
    // Strip \r for CRLF safety.
    return parts.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  }

  /** Drain whatever is left in the carry buffer (call once at stream end). */
  flush(): string | undefined {
    const rest = this.carry;
    this.carry = "";
    return rest.length > 0 ? rest : undefined;
  }
}

/** Parse a single NDJSON line; returns undefined for blank / non-JSON lines. */
export function parseJsonLine(line: string): unknown | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

export interface NdjsonReaderHandlers {
  /** Every complete raw line, JSON or not (e.g. for transcript persistence). */
  onRawLine?: (line: string) => void;
  /** Every successfully parsed JSON object. */
  onObject: (obj: unknown) => void;
  /** Non-empty lines that failed to parse as JSON. */
  onNonJson?: (line: string) => void;
}

/**
 * Stateful NDJSON reader: feed stdout chunks via `push`, call `end` when the
 * stream closes. Tolerant of non-JSON lines and split lines across chunks.
 */
export class NdjsonReader {
  private readonly buffer = new LineBuffer();

  constructor(private readonly handlers: NdjsonReaderHandlers) {}

  push(chunk: string | Buffer): void {
    for (const line of this.buffer.push(chunk)) {
      this.handleLine(line);
    }
  }

  end(): void {
    const rest = this.buffer.flush();
    if (rest !== undefined) this.handleLine(rest);
  }

  private handleLine(line: string): void {
    if (line.trim().length === 0) return;
    this.handlers.onRawLine?.(line);
    const obj = parseJsonLine(line);
    if (obj !== undefined) {
      this.handlers.onObject(obj);
    } else {
      this.handlers.onNonJson?.(line);
    }
  }
}

/**
 * Async-iterator convenience: yield parsed JSON objects from a readable
 * stream, tolerating non-JSON lines.
 */
export async function* readNdjson(
  stream: AsyncIterable<string | Buffer>,
): AsyncGenerator<unknown, void, undefined> {
  const buffer = new LineBuffer();
  for await (const chunk of stream) {
    for (const line of buffer.push(chunk)) {
      const obj = parseJsonLine(line);
      if (obj !== undefined) yield obj;
    }
  }
  const rest = buffer.flush();
  if (rest !== undefined) {
    const obj = parseJsonLine(rest);
    if (obj !== undefined) yield obj;
  }
}
