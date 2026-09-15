import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// Wires `next dev` up to the local Cloudflare Workers runtime (bindings,
// etc.) so dev behavior matches the deployed Worker.
initOpenNextCloudflareForDev();
