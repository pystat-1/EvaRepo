import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

// Installable, offline-first: the whole app (code, font, icons) is
// precached by the service worker, so it opens and grades with no signal.
// Updates install in the background and apply on the next launch.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "Eva — تطبيق المقيّم",
        short_name: "Eva المقيّم",
        description: "تقييم الطلاب في المستشفى، يعمل دون اتصال",
        lang: "ar",
        dir: "rtl",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f6f7f4",
        theme_color: "#06333d",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff,woff2,png,svg}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/admin\//],
      },
    }),
  ],
  resolve: { alias: { "@eva/core": fileURLToPath(new URL("../../packages/core/src", import.meta.url)) } },
  server: { port: 1430, strictPort: true },
  build: { target: "es2022" },
});
