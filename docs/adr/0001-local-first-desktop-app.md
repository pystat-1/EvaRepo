# ADR 0001: Admin side becomes a local-first desktop app (Tauri + SQLite)

- **Status:** accepted, 2026-09-30
- **Context:** the hosted Next.js + Prisma site exceeds the Cloudflare Workers Free CPU limit (10 ms; measured 17–50 ms warm, 60–500 ms cold), which cuts pages off (React #412). Saves are slow (~270 ms per database round trip to the US), and Neon backups fail on the free quota. The admin must be able to work without internet.
- **Decision:** the admin side is an installed Windows app built with **Tauri 2**. Its **SQLite** database file on the admin's computer is the only source of truth. One main computer; backups are copied to USB or Google Drive.
- **Alternatives:** Electron (installers ~150–200 MB, ~450 MB RAM, broader security surface); keeping the website on the paid Workers plan (still online-dependent; the owner wants to drop hosting problems).
- **Consequences:** Next.js server features (server components, server actions) are not used in the desktop app: it is a client-only React app (Vite). Prisma is replaced by Drizzle ORM on SQLite. Building needs Rust and the MSVC build tools (free).
