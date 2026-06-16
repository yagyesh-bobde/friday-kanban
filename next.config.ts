import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/node-only modules must not be bundled by Next's compiler.
  // They are require()'d at runtime from node_modules instead.
  serverExternalPackages: ["better-sqlite3", "node-pty"],
};

export default nextConfig;
