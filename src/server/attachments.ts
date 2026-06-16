/**
 * Prompt image attachments (server-only).
 *
 * Images attached in the New Task modal arrive as base64 data URLs on
 * CreateTaskInput. They are decoded and written to disk under
 * ~/.friday-kanban/attachments/<taskId>/ at create time, then referenced by
 * absolute path in the implementer prompt so the agent reads them with its
 * Read tool (local execution only — a remote VM cannot see these files).
 */

import fs from "node:fs";
import path from "node:path";
import type { TaskImageInput } from "@/lib/types";
import {
  ATTACHMENT_MIME_EXT,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/constants";
import { attachmentsDir, ensureDir } from "./paths";

const ALLOWED_EXTS = new Set(Object.values(ATTACHMENT_MIME_EXT));

/** `data:image/png;base64,iVBOR...` -> { mime, buffer } or null when malformed. */
function decodeDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const [, rawMime, payload] = match;
  if (rawMime === undefined || payload === undefined) return null;
  const mime = rawMime.toLowerCase();
  if (!(mime in ATTACHMENT_MIME_EXT)) return null;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(payload, "base64");
  } catch {
    return null;
  }
  if (buffer.length === 0 || buffer.length > MAX_ATTACHMENT_BYTES) return null;
  return { mime, buffer };
}

/** Strip directory separators / unsafe chars from a user-supplied filename's stem. */
function safeStem(name: string): string {
  const stem = path.basename(name).replace(/\.[^.]+$/, "");
  return (
    stem
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "image"
  );
}

/**
 * Decode + persist a task's prompt images. Invalid or oversized entries are
 * skipped. Returns the absolute paths actually written, in input order.
 */
export function saveTaskAttachments(taskId: string, images: TaskImageInput[]): string[] {
  if (images.length === 0) return [];
  const dir = ensureDir(attachmentsDir(taskId));
  const saved: string[] = [];
  images.slice(0, MAX_ATTACHMENTS).forEach((image, index) => {
    const decoded = decodeDataUrl(image.dataUrl);
    if (!decoded) return;
    const ext = ATTACHMENT_MIME_EXT[decoded.mime];
    const prefix = String(index + 1).padStart(2, "0");
    const filePath = path.join(dir, `${prefix}-${safeStem(image.name)}.${ext}`);
    fs.writeFileSync(filePath, decoded.buffer);
    saved.push(filePath);
  });
  return saved;
}

/**
 * Absolute paths of the image files saved for a task, sorted by name (stable
 * with the NN- prefix). Empty when the task has no attachments.
 */
export function listTaskAttachments(taskId: string): string[] {
  const dir = attachmentsDir(taskId);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => ALLOWED_EXTS.has(path.extname(name).slice(1).toLowerCase()))
    .sort()
    .map((name) => path.join(dir, name));
}
