import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // Keeps Next's own build step from bundling/resolving @prisma/client
  // itself (which would use generic Node conditions and always pick the
  // native-engine runtime) — instead it's resolved as a real package import
  // at OpenNext's later, Cloudflare-specific bundling pass, which sets
  // `workerd` conditions and lets the generated client's own conditional
  // exports resolve to its WASM engine. See src/lib/db.ts.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
};

export default nextConfig;

// Wires `next dev` up to the local Cloudflare Workers runtime (bindings,
// etc.) so dev behavior matches the deployed Worker.
initOpenNextCloudflareForDev();
