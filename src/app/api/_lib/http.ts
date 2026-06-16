/**
 * Shared HTTP helpers for the API routes: the ApiError envelope, zod body
 * parsing, and the NotImplementedError -> 501 mapping mandated by docs/API.md.
 *
 * Lives in an underscore-prefixed folder so the App Router never treats it as
 * a route segment.
 */

import type { ZodError, ZodType } from "zod";
import type { ApiError } from "@/lib/types";

/** Build the standard error envelope response: `{ error, code? }`. */
export function apiError(status: number, error: string, code?: string): Response {
  const body: ApiError = code ? { error, code } : { error };
  return Response.json(body, { status });
}

/** Human-readable single-line summary of a zod validation failure. */
export function zodErrorMessage(err: ZodError): string {
  return err.issues
    .map((issue) => {
      const path = issue.path.map((p) => String(p)).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/**
 * `instanceof` is unreliable across the dual module graphs (server.ts via tsx
 * vs Next's compiled routes, plus HMR re-evaluation), so detect the
 * orchestrator's NotImplementedError by name.
 */
export function isNotImplementedError(err: unknown): err is Error {
  return err instanceof Error && err.name === "NotImplementedError";
}

/**
 * Map an unexpected route failure to the contract's error envelope:
 * - NotImplementedError -> 501 not_implemented (scaffold phase)
 * - anything else       -> 500 internal
 */
export function handleRouteError(err: unknown): Response {
  if (isNotImplementedError(err)) {
    return apiError(501, err.message, "not_implemented");
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[api] unexpected route error:", err);
  return apiError(500, message, "internal");
}

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: Response };

/**
 * Read + zod-validate a JSON request body. On failure returns a ready-made
 * 400 invalid_input response.
 */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<ParsedBody<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: apiError(400, "Request body must be valid JSON", "invalid_input"),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: apiError(400, zodErrorMessage(parsed.error), "invalid_input"),
    };
  }
  return { ok: true, data: parsed.data };
}
