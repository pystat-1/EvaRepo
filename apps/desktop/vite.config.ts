import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Tauri serves the built files from dist/ and, in development, loads the
// Vite dev server on a fixed port.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@eva/core": fileURLToPath(new URL("../../packages/core/src", import.meta.url)),
      "@eva/db": fileURLToPath(new URL("../../packages/db/src", import.meta.url)),
    },
  },
  build: { target: "es2022", sourcemap: true },
});
