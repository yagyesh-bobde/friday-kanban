/**
 * macOS notifications via `osascript -e 'display notification ...'`.
 * No-op on non-darwin platforms. Fire-and-forget — never throws.
 * Also mirrors every notification onto the bus so the UI can badge cards.
 */

import { execFile } from "node:child_process";
import { publish } from "@/server/bus";

function escapeForAppleScript(text: string): string {
  // AppleScript string literals: escape backslashes and double quotes.
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function notify(title: string, body: string, taskId?: string): void {
  publish({ type: "notification", title, message: body, taskId });

  if (process.platform !== "darwin") return;

  const script = `display notification "${escapeForAppleScript(body)}" with title "${escapeForAppleScript(title)}"`;
  execFile("osascript", ["-e", script], { timeout: 10_000 }, (err) => {
    if (err) {
      console.warn(`[notify] osascript failed: ${String(err)}`);
    }
  });
}
