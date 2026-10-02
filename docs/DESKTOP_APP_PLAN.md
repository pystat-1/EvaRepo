# Eva Desktop: plan to turn Eva into installable, local-first software

> **Status:** ACCEPTED, 2026-09-30. Phases 1–3 done (see §10). Next: phase 4 (sync relay + evaluator phone app).
> **Goal (from the owner):** a top-tier, reliable **complete student data management system** that runs as an **installed desktop app** (no dependence on web hosting), with the **evaluator app** kept as a separate, simple, installable phone app **linked** to it.
> **Constraint:** free and open-source tools only.
> **Relation to other plans:** replaces the hosting model of `FINAL_PLAN.md`; keeps its product rules (courses → shifts → groups → rotations, rubric, validation, grading center). `EVALUATOR_APP_PLAN.md` rules (7-day window, conflicts, drafts) carry over to the new evaluator app.

---

## 1. Why change the architecture

What went wrong on the current stack, measured on 2026-09-30:

| Problem | Cause | Evidence |
|---|---|---|
| Pages cut off with React error #412 | Cloudflare Workers Free allows **10 ms CPU** per request; Next.js server rendering + Prisma's WASM engine use **17–50 ms warm, 60–500 ms cold** | `wrangler tail`: `"cpuTime": 10, "outcome": "exceededCpu"` |
| Slow saves (several seconds) | Every save makes many sequential trips to a database in the US (~270 ms each) | Profiling of `upsertEvaluation` |
| Backups failing since 2026-09-17 | Neon free-plan snapshot quota | `PROJECT_GOALS.md` Goal 2 note |
| Admin work stops when the internet or host is down | All data lives only on the server | — |

These are structural. Trimming code reduced them but cannot remove them (see commit `1ba445e`).

## 2. What the best desktop apps do (research summary)

| Practice | Who does it | What it means for Eva |
|---|---|---|
| **Web UI inside a native shell** | VS Code, Slack, Discord, Figma, Notion, Linear (Electron) | Reuse our React UI; ship it as an installed app |
| **Local-first data**: the app's own database is the source of truth, reads are instant, the server only syncs | Linear (IndexedDB + transaction queue), Notion (SQLite), local-first movement | Admin data in a **SQLite file on the laptop**; works with no internet |
| **Optimistic writes + durable queue**: a change shows at once, is saved locally, and is sent later | Linear | Evaluator phones already do this (outbox); extend it to the sync relay |
| **Central ordering of changes** instead of complex merging | Linear (server orders all transactions) | The **desktop app decides** conflicts (it already has the admin conflict rules) |
| **Crash containment**: error boundaries per screen, autosave/drafts, restore after restart | VS Code (hot exit), browsers, Office autosave | Every screen isolated; drafts autosaved; crash-safe database (WAL) |
| **Signed auto-updates** | All of them | Updates download in the background and apply on restart |
| **Keyboard-first, command palette** | VS Code, Linear, Slack, Figma | `Ctrl+K`: jump to any student/group/screen |
| **Virtualized big tables** | Linear, Notion, Excel-like apps | Thousands of rows stay smooth |
| **Design system + tokens** | all | Keep Eva's existing tokens ("clinical ledger") |
| **Testing pyramid + CI** | all | Unit (logic) → integration (database) → end-to-end (UI) on every change |

**Tauri vs Electron** (the two shells): Tauri installers are about **3–12 MB vs ~150–200 MB**, use **~30–85 MB vs ~450 MB RAM**, and have a stricter least-privilege security model. The 2026 consensus is to default to Tauri unless a project needs Electron-only features. Eva doesn't.

## 3. Engineering concepts that will be applied

- **Requirements and use cases:** written per role (admin, evaluator, student), before each phase.
- **Domain model (ERD):** the existing Prisma schema becomes the SQLite schema, the same entities without the hosting-only tables.
- **State machines:**
  - student-day: free → taken → saved → validated → locked, with a disputed branch;
  - sync item: queued → sent → acknowledged or rejected.

  These already exist in code; they get diagrams and tests.
- **Flowcharts:** Excel import, course publishing, evaluator sync, validation, backup/restore (§6).
- **Algorithms:**
  - rotation generation (Latin square, already in `rotationGenerator.ts`);
  - idempotent sync, where the same change applied twice has the same effect as once (client IDs);
  - conflict detection;
  - validation rules as pure, tested functions (already started in `src/lib/evaluator`, `src/lib/studentImport`).
- **Architecture Decision Records (ADRs):** one short file per big decision, in `docs/adr/`.
- **Defensive programming:** validate every input at the boundary (Zod schemas); never trust the phone's clock or IDs; every write in a transaction.
- **Versioned migrations:** the database file carries its schema version; the app upgrades it on start, after a backup.

## 4. Selected free tools

| Need | Choice | Licence | Why |
|---|---|---|---|
| Desktop shell | **Tauri 2** | MIT / Apache-2.0 | Small, fast, secure; uses the Windows WebView2 already on Windows 10/11 |
| UI | **React** (existing) built with **Vite** | MIT | Next.js server features can't run inside a desktop app; Vite builds a pure client app |
| Routing | **TanStack Router** | MIT | Type-safe tabs/screens, works offline |
| Local database | **SQLite** via **tauri-plugin-sql** | MIT / Apache-2.0 | One file, crash-safe (WAL), no server |
| Database code | **Drizzle ORM** (SQLite) | Apache-2.0 | Typed queries and migrations; runs in the app (Prisma can't) |
| Data caching / optimistic UI | **TanStack Query** | MIT | Instant screens, background refresh |
| Big tables | **TanStack Table + Virtual** | MIT | Sorting, filtering, 10 000+ rows smoothly |
| Input validation | **Zod** | MIT | One schema per form, import and sync message |
| Command palette | **cmdk** | MIT | `Ctrl+K` search |
| Excel | **ExcelJS** (existing) | MIT | Template, import, export |
| Charts | **Recharts** | MIT | Statistics screens |
| Crash handling | **react-error-boundary**, **tauri-plugin-log** | MIT | Per-screen recovery, local log files |
| Updates | **tauri-plugin-updater** + **GitHub Releases** | MIT / free | Signed updates; free signing key |
| Evaluator phone app | Static **PWA** (Vite + React) + **Dexie** (IndexedDB) | MIT / Apache-2.0 | Installable from a link, fully offline |
| Evaluator app hosting | **Cloudflare Pages** (static files) | free | Static files use no server CPU, so the 10 ms limit doesn't apply |
| Sync relay | Tiny **Cloudflare Worker** + **D1** (SQLite) | free tier | A few hundred lines, no Next.js or Prisma: ~1–3 ms CPU per request |
| Tests | **Vitest** (existing), **Playwright** (existing), **fast-check** | MIT | Logic, database and UI tests; property tests for rotation and validation |
| Build and release | **GitHub Actions** | free | Builds the Windows installer on every release tag |

**Not free, noted honestly:** a Windows code-signing certificate costs money. Without one, Windows SmartScreen shows "unknown publisher" on first install. The app and its auto-updates are still verified by Tauri's own free signing key.

## 5. Target architecture

```
┌──────────── Admin laptop: Eva Desktop (Tauri) ─────────────────────┐
│ React UI (tabs: الطلاب · الدورات · الجدول · مركز الدرجات · …)       │
│      │ TanStack Query (instant, optimistic)                          │
│ Data layer (Drizzle) ── SQLite file  eva.db  (WAL, source of truth) │
│      │                  ├─ automatic backups: daily + before updates │
│      │                  └─ export: Excel / one-file backup           │
│ Sync service (background): publish course → relay; pull grades ←     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS (only when online; retries)
┌──────────────────────────────▼──────────────────────────────────────┐
│ Relay (Cloudflare Worker + D1, free): a mailbox, not the database    │
│  • course bundle per evaluator (rosters, schedule, rubric)           │
│  • evaluator logins (hashed)                                          │
│  • append-only journal of evaluator submissions (idempotent IDs)     │
└──────────────────────────────▲──────────────────────────────────────┘
                               │ HTTPS (only when online; outbox)
┌──────────────────────────────┴──────────────────────────────────────┐
│ Evaluator phone app (installed PWA, static on Cloudflare Pages)      │
│  Dexie/IndexedDB: bundle + drafts + outbox · works fully offline     │
└──────────────────────────────────────────────────────────────────────┘
```

Rules:
- The **desktop SQLite file is the only source of truth**. The relay holds copies and a mailbox; losing it loses nothing that the desktop has already pulled.
- The desktop applies submissions in the order the relay received them, using the existing rules: 7-day window, conflicts shown to the admin, validation, locking.
- **Without internet:** the admin works normally; evaluators keep grading. Both sync when a connection returns.

## 6. Key flows (to be drawn as diagrams in phase 1)

1. **Import students:** Excel file → validate every row (preview) → one transaction → backup snapshot.
2. **Publish course:** admin presses publish → bundle per evaluator → relay → phones download on next open.
3. **Evaluator grading:** open app → today's group from schedule (or pick one) → grade (autosave draft) → validate → outbox → relay.
4. **Desktop pull:** background, every few minutes when online → new journal entries → apply (or conflict) → acknowledge → grading center updates.
5. **Backup / restore:** automatic daily backup and before every update or migration; keep 30; restore = pick a backup, confirm, restart.

## 7. Reliability checklist (definition of "top tier" for Eva)

- [x] No lost data: every write is a transaction; drafts autosave; WAL mode; `PRAGMA integrity_check` on start.
- [x] Automatic local backups (daily and pre-update), plus one-click export of the whole database.
- [x] Crash containment: a failing screen shows a recovery panel, never a white screen; logs are written to a file the admin can send (النظام → حفظ تقرير تشخيصي).
- [x] Start-up self-check: database version, disk space, last backup age, sync status (plus waiting decisions and updates).
- [x] Every input validated and every error shown in Arabic with a next step. (Hand-written, tested validators in `@eva/core` and the repositories rather than Zod.)
- [x] Sync is idempotent and resumable; nothing is applied twice; conflicts go to the admin.
- [x] Tests on every change: logic (unit), database (integration), key screens (end-to-end, in CI).
- [x] Signed auto-updates with a backup before applying.
- [x] Performance budget: any screen opens in under 200 ms with 5 000 students (and 50 000 grades).

## 8. Phased roadmap

Each phase ends with something usable and tested. The current website keeps running until phase 6.

| Phase | Deliverable | Est. effort |
|---|---|---|
| **1 Foundations** | Monorepo: `apps/desktop`, `apps/evaluator`, `apps/relay`, `packages/core` (shared rules: rubric, rotation, validation, import); ADRs; diagrams; CI | small |
| **2 Desktop data layer** | Tauri shell, SQLite schema + migrations (Drizzle), data import from the current database, backups/restore | medium |
| **3 Admin screens** | Port students (with Excel), courses/setup, schedule, grading center, statistics, audit log; command palette; virtualized tables | large |
| **4 Relay + evaluator app** | Worker + D1 relay; evaluator PWA rebuilt on the new bundle/outbox; publish and pull in the desktop | large |
| **5 Hardening** | Crash handling, logs, self-check, auto-updater, installer, performance budget, full end-to-end tests | medium |
| **6 Switch-over** | Final data migration, evaluators move to the new link, old Next.js site retired | small |

## 9. Decisions (confirmed 2026-09-30)

1. **Sync route:** tiny free relay, Cloudflare Worker + D1 (ADR 0002).
2. **Operating system:** Windows 10/11 first; macOS later from the same code.
3. **Admins:** one main computer is the source of truth; backups can be copied to USB or Google Drive.
4. **Transition:** the current website keeps running until switch-over (phase 6).

Architecture decisions are recorded in `docs/adr/`; flow diagrams are in `docs/FLOWS.md`.

## Sources

- Tauri vs Electron 2026: https://www.pkgpulse.com/guides/electron-vs-tauri-2026 · https://rustify.rs/articles/rust-tauri-vs-electron-2026 · https://www.buildmvpfast.com/blog/tauri-v2-vs-electron-desktop-apps-2026
- Local-first software: https://www.alexcloudstar.com/blog/local-first-software-developer-guide-2026/ · https://turso.tech/blog/building-local-first-apps-the-complete-guide-to-offline-first-database-sync · https://noqta.tn/en/blog/local-first-software-architecture-sqlite-production-2026
- Linear's sync engine: https://performance.dev/how-is-linear-so-fast-a-technical-breakdown · https://www.fujimon.com/blog/linear-sync-engine · https://github.com/wzhudev/reverse-linear-sync-engine
- Desktop app architecture (Electron users): https://squashapps.com/blog/desktop-application-development-guide-2021/
- Tauri updater and Windows signing: https://v2.tauri.app/plugin/updater/ · https://v2.tauri.app/distribute/sign/windows/
- Cloudflare Workers limits (10 ms CPU on Free): https://developers.cloudflare.com/workers/platform/limits/
- Reliability engineering: https://www.computer.org/publications/tech-news/trends/software-reliability

## 10. Progress log

- **Phase 1 (2026-09-30):** `packages/core` (shared rules, tested), ADRs 0001–0004, `docs/FLOWS.md`, CI (type-check + tests on every push; deploy gated on them).
- **Phase 2 (2026-09-30):**
  - `packages/db`: SQLite schema mirroring the website's 21 tables; versioned migrations (`0000_init`); a migration runner that is atomic, refuses files from newer versions and backs up first; the backup policy (daily, before migrate/import/restore; keep 30 plus one per month for 12 months); the start-up sequence (integrity check → backup → migrate → daily backup → prune). 21 tests on real SQLite.
  - `scripts/export-to-sqlite.ts`: website database → `eva.db`, read-only on the source, verifies row counts, integrity and foreign keys. Verified on the pre-reset backup: 387 evaluations and 158 students identical value for value.
  - `apps/desktop`: Tauri 2 app. The Rust side owns `eva.db` (WAL, foreign keys, online backups, validated import/restore, backup-name checks, panic logging to a log file); React shell with per-screen crash boundaries, a recovery screen for damaged or too-new files, and the النظام screen (health, counts, backups, backup now, restore, import).
  - Windows installer: 3.24 MB (NSIS). Tested in the real window: first run, manual backup, import of the exported data (158 students / 387 grades), restore, rejection of non-Eva files and of path-traversal backup names.
  - `.github/workflows/desktop.yml` builds the installer on GitHub's Windows machines.
- **Phase 3 (2026-09-30):**
  - Data layer `packages/db/src/repo/`: students (Arabic-aware search, add/edit with validation and codes, activate, whole-file Excel import in ONE transaction with a chosen target course), courses (overview grid, move a schedule cell, create a course with groups and a fair rotation), evaluators (add/edit, hospitals per course, activate), grading (validated grades with filters, student record, group grade sheet, statistics), audit log. Every write is a single atomic batch (`db_batch`) that includes its audit entry. 104 tests.
  - Shared `@eva/core`: Arabic search normalisation; the Excel template builder/reader (the website now uses it too).
  - Desktop screens: الطلاب، الدورات والجدول، مركز الدرجات (list + group sheet + Excel export)، الإحصائيات، المقيّمون، سجل التغييرات، النظام. Virtualized tables, Ctrl+K palette, Ctrl+1..7, per-screen crash boundaries, save dialogs for Excel files (Rust `file_write`, xlsx/csv/db only).
  - End-to-end test in the real window with 120 students / 600 grades: every screen, dialog, import, schedule edit, new course, palette; integrity ok, no page errors. Installer 4.07 MB.
- **Phase 4 (2026-09-30):**
  - Shared contract `@eva/core/sync`: the evaluator bundle (their groups, students, rotation, rubric), the validated-day submission (idempotent `clientId`), results; PBKDF2 passwords (only hashes ever leave the desktop).
  - `apps/relay`: Cloudflare Worker + D1 (`eva-relay`), a mailbox only. Evaluator login (rate-limited, 30-day sessions revoked on password change/deactivation), bundle with ETag, submissions stamped with the session's evaluator, results back to the phone; admin endpoints (publish, pull by cursor, results, status) behind a secret key, CORS only for the desktop app. The evaluator app is served as static assets (no Worker CPU). 7 tests.
  - `apps/evaluator`: installable PWA, works fully offline (drafts, outbox, cached bundle in IndexedDB), syncs on open/online/every minute; today's scheduled groups plus any other group (holidays), sticky grade grid with autosave, validate → outbox, overdue reminders, per-day status from the desktop's decision. 6 tests.
  - Desktop: المزامنة screen (server settings, test connection, sync now, auto-sync every 5 min), phone passwords per evaluator (shown once), `sync_inbox` table + migration `0001`. The desktop re-checks every submission (scope, roster, scores); a day already graded by another evaluator is held as a conflict until the admin chooses a version. In-app confirmation dialog replaces `window.confirm`. 8 tests.
  - End-to-end test (real desktop window + phone browser + live relay): publish, phone login, validate a day, validate offline then send on reconnect, conflict from a second evaluator, pull (2 applied, 1 conflict), phone shows the decision, admin applies the other version, grading center updated; integrity ok, no page errors.
- **After phase 4 (2026-09-30):** evaluators sign in on the phone with Google (the email the admin registered; no passwords; migration 0002 on the relay); sync runs by itself (after start, a few seconds after any change, every minute, when back online); the evaluator app gained جدولي، السجلات (previous assessments, attendance log)، طلابي and downloads (a day's grades and blank printable templates in Excel and Word; schedule, log, history and students in Excel), all offline; the desktop sends each evaluator their validated history in the bundle.
- **Phase 5 (2026-09-30):**
  - Self-check at start and every 5 minutes (`lib/selfCheck.ts`, tested): database, disk space, backup age, sync, decisions waiting, updates; a banner over every screen when something needs attention, and the list in النظام.
  - Support: a diagnostic report (facts, checks and the log's end; no student data) saved as a text file; open the logs, backups or data folder (Rust `system.rs`: only Eva's own folders).
  - Signed automatic updates (tauri-plugin-updater): checked 20 s after start and every 6 hours from GitHub Releases; installing takes a backup first, verifies the signature against the key built into the app, installs and restarts. The release workflow publishes the installer, its signature and `latest.json` on a `desktop-v*` tag. The signing key lives outside the repo (see ADMIN_CREDENTIALS.md).
  - Performance: the budget test found the grading center taking 10.4 s with 50 000 grades (all rows loaded; scores fetched by a list of 50 000 ids, which SQLite would refuse past 32 766; a new Arabic collator per comparison). Now: the newest 1 500 open at once with the total count, search and export read everything, one shared collator. Every screen is under 200 ms (grading center 161 ms).
  - End-to-end tests in the repo (`npm run e2e -w @eva/desktop`): the whole loop (desktop UI, relay code, phone app with a stand-in for Google, offline grading, downloads) and the performance budget with 5 004 students; they run in CI on every push.
  - Installer 0.2.0: 5.1 MB, per-user, Arabic/English.

