/**
 * Known model slugs per provider for the model selects. Free-form entry is
 * still possible (the inputs use a datalist), these are just the verified
 * current slugs from docs/research/architecture-proposal.md.
 */

import type { Effort, Provider } from "@/lib/types";

export const PROVIDER_OPTIONS: { value: Provider; label: string }[] = [
  { value: "claude-code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
];

export const MODEL_OPTIONS: Record<Provider, string[]> = {
  "claude-code": ["opus", "sonnet", "haiku", "fable"],
  codex: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"],
};

export const EFFORT_OPTIONS: { value: Effort; label: string }[] = [
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max (codex: xhigh)" },
];

export function defaultModelFor(provider: Provider): string {
  return provider === "codex" ? "gpt-5.5" : "opus";
}
