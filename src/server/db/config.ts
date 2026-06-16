/**
 * Repository for the `config` table. The whole AppConfig is stored as one JSON
 * value under a single key, deep-merged over DEFAULT_APP_CONFIG on read so new
 * config fields get sane defaults without migrations.
 */

import { DEFAULT_APP_CONFIG } from "@/lib/constants";
import { appConfigSchema } from "@/lib/schemas";
import type { AppConfig, UpdateConfigInput } from "@/lib/types";
import { getDb } from "./index";

const CONFIG_KEY = "app_config";

function mergeConfig(stored: Partial<AppConfig> | undefined): AppConfig {
  const merged: AppConfig = {
    ...DEFAULT_APP_CONFIG,
    ...stored,
    columnDefaults: {
      in_dev: stored?.columnDefaults?.in_dev ?? DEFAULT_APP_CONFIG.columnDefaults.in_dev,
      in_review: stored?.columnDefaults?.in_review ?? DEFAULT_APP_CONFIG.columnDefaults.in_review,
    },
  };
  // Validate the merged shape; fall back to defaults on corruption.
  const parsed = appConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_APP_CONFIG;
}

export function getConfig(): AppConfig {
  const row = getDb().prepare(`SELECT value FROM config WHERE key = ?`).get(CONFIG_KEY) as
    | { value: string }
    | undefined;
  if (!row) return DEFAULT_APP_CONFIG;
  try {
    return mergeConfig(JSON.parse(row.value) as Partial<AppConfig>);
  } catch {
    return DEFAULT_APP_CONFIG;
  }
}

/** Shallow-merges the patch over current config, persists, returns the result. */
export function setConfig(patch: UpdateConfigInput): AppConfig {
  const next = mergeConfig({ ...getConfig(), ...patch });
  getDb()
    .prepare(
      `INSERT INTO config (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(CONFIG_KEY, JSON.stringify(next));
  return next;
}

/** Generic raw KV access for non-AppConfig bookkeeping (e.g. cursors). */
export function getConfigValue(key: string): string | undefined {
  const row = getDb().prepare(`SELECT value FROM config WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setConfigValue(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO config (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}
