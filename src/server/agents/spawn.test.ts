import { test } from "node:test";
import assert from "node:assert/strict";
import { augmentPathEnv } from "./spawn";

// augmentPathEnv only reads PATH and HOME; cast partial literals to the env type
// (the project augments ProcessEnv with required keys like NODE_ENV).
const env = (e: { HOME?: string; PATH?: string }): NodeJS.ProcessEnv =>
  e as NodeJS.ProcessEnv;

test("augmentPathEnv appends ~/.local/bin when missing (the ENOENT root cause)", () => {
  const out = augmentPathEnv(env({ HOME: "/home/u", PATH: "/usr/bin:/bin" }));
  const parts = (out.PATH ?? "").split(":");
  assert.ok(parts.includes("/home/u/.local/bin"), "should add ~/.local/bin");
  assert.ok(parts.includes("/usr/bin"), "should preserve existing entries");
  // existing entries keep precedence (appended, not prepended)
  assert.ok(parts.indexOf("/usr/bin") < parts.indexOf("/home/u/.local/bin"));
});

test("augmentPathEnv does not duplicate an entry already on PATH", () => {
  const out = augmentPathEnv(env({ HOME: "/home/u", PATH: "/home/u/.local/bin:/usr/bin" }));
  const count = (out.PATH ?? "").split(":").filter((p) => p === "/home/u/.local/bin").length;
  assert.equal(count, 1);
});

test("augmentPathEnv handles a missing PATH", () => {
  const out = augmentPathEnv(env({ HOME: "/home/u" }));
  assert.ok((out.PATH ?? "").split(":").includes("/home/u/.local/bin"));
});

test("augmentPathEnv handles a missing HOME (no home-relative dirs, still adds system dirs)", () => {
  const out = augmentPathEnv(env({ PATH: "/usr/bin" }));
  const parts = (out.PATH ?? "").split(":");
  assert.ok(parts.includes("/opt/homebrew/bin"));
  assert.ok(parts.includes("/usr/local/bin"));
  assert.ok(!parts.some((p) => p.endsWith("/.local/bin")));
});
