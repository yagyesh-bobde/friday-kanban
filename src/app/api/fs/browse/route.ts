/**
 * GET /api/fs/browse?path=<abs> — list a directory's subfolders for the Add
 * Project folder picker. Read-only. Each subfolder is flagged when it is a git
 * repo (has a .git entry) so the UI can offer single-repo selection or
 * multi-repo auto-detection. Defaults to the user's home directory.
 *
 * This is a localhost developer tool, so it intentionally browses the local
 * filesystem; it never reads file contents, only directory listings + stats.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FsBrowseResult, FsEntry } from "@/lib/types";
import { apiError, handleRouteError } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function resolvePath(input: string | null): string {
  if (!input || input.trim() === "") return os.homedir();
  let p = input.trim();
  if (p === "~" || p.startsWith("~/")) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

/** A folder is treated as a git repo when it has a `.git` entry (dir or file). */
function isGitRepo(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, ".git"));
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const dir = resolvePath(url.searchParams.get("path"));

    let stat: fs.Stats;
    try {
      stat = fs.statSync(dir);
    } catch {
      return apiError(400, `path does not exist: ${dir}`, "invalid_input");
    }
    if (!stat.isDirectory()) {
      return apiError(400, `path is not a directory: ${dir}`, "invalid_input");
    }

    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return apiError(
        400,
        `cannot read directory: ${err instanceof Error ? err.message : String(err)}`,
        "invalid_input",
      );
    }

    const entries: FsEntry[] = [];
    for (const d of dirents) {
      // Skip files and dotfiles, but keep dotted dirs that aren't hidden noise.
      if (d.name.startsWith(".")) continue;
      let isDir = d.isDirectory();
      // Resolve symlinked directories too.
      if (!isDir && d.isSymbolicLink()) {
        try {
          isDir = fs.statSync(path.join(dir, d.name)).isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (!isDir) continue;
      const full = path.join(dir, d.name);
      entries.push({ name: d.name, path: full, isGitRepo: isGitRepo(full) });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    const parent = path.dirname(dir);
    const result: FsBrowseResult = {
      path: dir,
      parent: parent === dir ? null : parent,
      home: os.homedir(),
      isGitRepo: isGitRepo(dir),
      entries,
    };
    return Response.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
