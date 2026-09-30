import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@eva/core": fileURLToPath(new URL("./packages/core/src", import.meta.url)),
      "@eva/db": fileURLToPath(new URL("./packages/db/src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "packages/**/*.test.ts", "apps/**/src/**/*.test.ts"],
  },
});
