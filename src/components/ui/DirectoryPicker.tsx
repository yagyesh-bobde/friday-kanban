"use client";

/**
 * Folder picker for the Add Project modal. Browses the local filesystem via
 * GET /api/fs/browse (read-only) starting at the user's home directory. Click a
 * folder to descend, the arrow to go up. Git repos are flagged so the caller
 * can offer single-repo selection or multi-repo auto-detection. The currently
 * listed directory's browse result is reported via `onResult`.
 */

import { useEffect, useState } from "react";
import type { FsBrowseResult } from "@/lib/types";
import { api, ApiHttpError } from "@/store/api";
import { cn } from "@/components/util";
import { IconArrowLeft, IconBranch, IconFolder, Spinner } from "./icons";

export function DirectoryPicker({
  onResult,
  className,
}: {
  onResult: (result: FsBrowseResult) => void;
  className?: string;
}) {
  // undefined → server defaults to the home directory on first load.
  const [path, setPath] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<FsBrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    api
      .fsBrowse(path)
      .then((res) => {
        if (!live) return;
        setResult(res);
        onResult(res);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setError(err instanceof ApiHttpError ? err.friendly : String(err));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return (
    <div className={cn("rounded-md border border-edge bg-raised", className)}>
      <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
        <button
          type="button"
          onClick={() => result?.parent && setPath(result.parent)}
          disabled={!result?.parent}
          className="rounded p-1 text-faint transition-colors hover:text-ink disabled:opacity-30"
          title="Up one level"
          aria-label="Up one level"
        >
          <IconArrowLeft size={14} />
        </button>
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-mute"
          title={result?.path}
        >
          {result?.path ?? "…"}
        </span>
        {loading ? <Spinner size={12} className="text-faint" /> : null}
      </div>

      <div className="max-h-56 overflow-y-auto p-1">
        {error ? (
          <p className="px-2 py-4 text-center text-[11px] text-danger">{error}</p>
        ) : result && result.entries.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-faint">
            No subfolders here.
          </p>
        ) : (
          result?.entries.map((e) => (
            <button
              key={e.path}
              type="button"
              onClick={() => setPath(e.path)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-hover"
            >
              <IconFolder
                size={14}
                className={cn("shrink-0", e.isGitRepo ? "text-ember" : "text-faint")}
              />
              <span className="min-w-0 flex-1 truncate text-ink">{e.name}</span>
              {e.isGitRepo ? (
                <span className="inline-flex items-center gap-1 rounded bg-ember/12 px-1.5 py-px font-mono text-[9.5px] text-ember">
                  <IconBranch size={9} /> repo
                </span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
