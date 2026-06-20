/**
 * A tiny per-key async mutex. Calls with the same key run strictly one at a
 * time, in arrival order; different keys are independent.
 *
 * Used to serialize the SHORT git critical sections (workspace prep, scoped
 * commit) for tasks that share a checkout on the same (project, branch), while
 * their long agent runs proceed in parallel. globalThis-cached so every module
 * graph in the process shares one set of chains.
 */

const GLOBAL_KEY = "__fridayKanbanKeyedLocks" as const;

type GlobalWithLocks = typeof globalThis & {
  [GLOBAL_KEY]?: Map<string, Promise<unknown>>;
};

function chains(): Map<string, Promise<unknown>> {
  const g = globalThis as GlobalWithLocks;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY];
}

/** Run `fn` exclusively for `key`, queued behind any in-flight holder. */
export function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const map = chains();
  const prev = map.get(key) ?? Promise.resolve();
  // Chain `fn` after the previous tail regardless of how it settled.
  const run = prev.then(fn, fn);
  // The stored tail must never reject, or the next caller would inherit the error.
  map.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
