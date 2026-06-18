/**
 * Live agent-process registry: taskId -> kill handle, plus a canceled-task
 * set so pipeline phases can distinguish "user canceled" from "agent failed"
 * after a kill. globalThis-cached (HMR shares one instance).
 */

interface RegistryState {
  /** taskId -> kill functions for every live process of that task. */
  kills: Map<string, Set<() => void>>;
  /** Tasks explicitly canceled by the user; consumed by the pipeline. */
  canceled: Set<string>;
  /**
   * Tasks whose live agent was interrupted by a mid-task user message (NOT a
   * cancel). The pipeline treats an interrupt as "stop this run cleanly and
   * resume with the queued message" rather than a failure.
   */
  interrupted: Set<string>;
}

const GLOBAL_KEY = "__fridayKanbanProcessRegistry" as const;

type GlobalWithRegistry = typeof globalThis & {
  [GLOBAL_KEY]?: RegistryState;
};

function state(): RegistryState {
  const g = globalThis as GlobalWithRegistry;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { kills: new Map(), canceled: new Set(), interrupted: new Set() };
  }
  return g[GLOBAL_KEY];
}

/** Register a live process kill handle for a task. Returns an unregister fn. */
export function registerProcess(taskId: string, kill: () => void): () => void {
  const s = state();
  let set = s.kills.get(taskId);
  if (!set) {
    set = new Set();
    s.kills.set(taskId, set);
  }
  set.add(kill);
  return () => {
    set.delete(kill);
    if (set.size === 0) s.kills.delete(taskId);
  };
}

/** True if the task currently has at least one live agent process. */
export function hasLiveProcess(taskId: string): boolean {
  return state().kills.has(taskId);
}

/**
 * Mark the task canceled and kill all of its live processes.
 * Returns true if any process was killed.
 */
export function cancelProcesses(taskId: string): boolean {
  const s = state();
  s.canceled.add(taskId);
  const set = s.kills.get(taskId);
  if (!set || set.size === 0) return false;
  for (const kill of set) {
    try {
      kill();
    } catch {
      // best effort
    }
  }
  return true;
}

/**
 * Kill every live agent process across all tasks (server shutdown). Does NOT
 * mark tasks canceled — boot-time crash recovery reconciles their DB state.
 */
export function killAllProcesses(): void {
  for (const set of state().kills.values()) {
    for (const kill of set) {
      try {
        kill();
      } catch {
        // best effort
      }
    }
  }
}

/** Check whether the task was canceled (without consuming the flag). */
export function wasCanceled(taskId: string): boolean {
  return state().canceled.has(taskId);
}

/** Clear the canceled flag (when a task is retried / restarted). */
export function clearCanceled(taskId: string): void {
  state().canceled.delete(taskId);
}

/**
 * Mark the task interrupted (mid-task message) and kill its live process(es).
 * Unlike cancel, this is NOT a failure — the pipeline resumes with the queued
 * message. Returns true if a live process was killed.
 */
export function interruptProcesses(taskId: string): boolean {
  const s = state();
  s.interrupted.add(taskId);
  const set = s.kills.get(taskId);
  if (!set || set.size === 0) return false;
  for (const kill of set) {
    try {
      kill();
    } catch {
      // best effort
    }
  }
  return true;
}

/** Check whether the task was interrupted by a mid-task message. */
export function wasInterrupted(taskId: string): boolean {
  return state().interrupted.has(taskId);
}

/** Clear the interrupted flag (after the pipeline has drained the message). */
export function clearInterrupted(taskId: string): void {
  state().interrupted.delete(taskId);
}
