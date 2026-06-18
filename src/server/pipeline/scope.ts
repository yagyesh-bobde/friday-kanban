/**
 * File-scope reasoning for same-branch parallelism.
 *
 * A task's `scopePaths` are glob/path patterns (relative to the repo root) it
 * is allowed to touch. The scheduler runs two same-branch tasks concurrently
 * only when their scopes are DISJOINT; the implementer commits only the changed
 * files that fall INSIDE the scope. Both questions reduce to a deliberately
 * simple, conservative path-prefix model (favouring "serialize / include" when
 * a pattern is too fancy to reason about precisely):
 *
 * - A pattern's "static prefix" is the path before its first wildcard, with any
 *   trailing slash and `/**` or `/*` stripped (e.g. `src/server/**` -> `src/server`).
 * - Two patterns overlap when one static prefix is a path-prefix of the other.
 * - An EMPTY scope means "undeclared" → treated as touching everything, so it
 *   overlaps with every other scope (preserving the original serialize-by-branch
 *   behaviour for tasks that don't opt in).
 */

function normalize(pattern: string): string {
  return pattern.trim().replace(/^\.\//, "").replace(/^\/+/, "");
}

/** The path portion of a pattern before its first wildcard, sans trailing slashes. */
function staticPrefix(pattern: string): string {
  const p = normalize(pattern);
  const star = p.indexOf("*");
  const base = star === -1 ? p : p.slice(0, star);
  return base.replace(/\/+$/, "");
}

function segments(p: string): string[] {
  return p.split("/").filter((s) => s.length > 0);
}

/** True when `a`'s segments are a (non-strict) path-prefix of `b`'s. */
function isPathPrefix(a: string, b: string): boolean {
  const A = segments(a);
  const B = segments(b);
  if (A.length > B.length) return false;
  return A.every((seg, i) => seg === B[i]);
}

/** Do two individual patterns refer to overlapping regions of the tree? */
function patternsOverlap(a: string, b: string): boolean {
  const pa = staticPrefix(a);
  const pb = staticPrefix(b);
  // A wildcard at the very root (or an empty static prefix) matches anything.
  if (pa === "" || pb === "") return true;
  return isPathPrefix(pa, pb) || isPathPrefix(pb, pa);
}

/**
 * Do two task scopes overlap? Empty (undeclared) scope = touches everything.
 * Used by the scheduler to decide parallel vs. queue.
 */
export function scopesOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  for (const x of a) {
    for (const y of b) {
      if (patternsOverlap(x, y)) return true;
    }
  }
  return false;
}

/**
 * Does a concrete changed file fall inside a task's declared scope? Used by the
 * implementer to stage only in-scope files. A file matches a pattern when the
 * pattern's static prefix is a path-prefix of the file (covers `dir/**`,
 * `dir/`, an exact file path, and a bare directory).
 */
export function matchesScope(file: string, scopePaths: string[]): boolean {
  const f = normalize(file);
  for (const pattern of scopePaths) {
    const prefix = staticPrefix(pattern);
    if (prefix === "") return true;
    if (f === prefix) return true;
    if (isPathPrefix(prefix, f)) return true;
  }
  return false;
}
