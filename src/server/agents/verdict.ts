/**
 * Shared review-verdict parsing: take a raw agent output string (codex's
 * -o outfile, or a claude reviewer's final message), salvage the JSON object
 * if it's wrapped in prose/fences, and zod-validate it into a ReviewVerdict.
 */

import type { ReviewVerdict } from "@/lib/types";
import { reviewVerdictSchema } from "@/lib/schemas";

export function parseVerdict(raw: string): { verdict?: ReviewVerdict; error?: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { error: "verdict output is empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // The final message sometimes wraps JSON in a code fence or prose — salvage
    // the outermost {...} block and try again.
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return { error: "verdict output is not JSON" };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return { error: "verdict output is not JSON" };
    }
  }

  const result = reviewVerdictSchema.safeParse(parsed);
  if (!result.success) {
    return { error: `verdict failed schema validation: ${result.error.message.slice(0, 500)}` };
  }
  return { verdict: result.data };
}
