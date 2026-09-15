# Eva v3 — Active Goals & Progress

**Read this file first in any new session before doing anything else.** It is the
persistent memory across context resets / session-limit restarts. After finishing
any task below, update its status and the "Session Log" at the bottom **before**
ending the turn — that is the mechanism that lets work continue across restarts.

Knowledge base: `graphify-out/GRAPH_REPORT.md` (human-readable) and
`graphify-out/graph.json` (queryable — `graphify query "<question>"`) hold a full
structural map of this codebase. Consult them before large changes; re-run
`graphify <path> --update` after significant structural changes so they stay current.

**CANONICAL LIVE SITE (as of 2026-09-15): https://eva-v3-app-gsfa.netlify.app**
— the original `eva-v3-app.netlify.app` (site id `400fb70b-5646-424a-baf2-ae5cfd9e5e9b`,
account `ammar.abd2000@conursing.uobaghdad.edu.iq`) hit its Netlify free-tier build
quota and is dormant/unmaintained until that resets — do not deploy there, do not
report it as "the site" without checking this note first.

Repo: https://github.com/pystat-1/EvaRepo
Neon project: `dry-cell-81671466` (DB name `eva`, unchanged — both Netlify sites
point at the same database)
**Current Netlify site**: `eva-v3-app-gsfa` (id `61860730-67b5-4418-81bf-a89c30900e45`),
account `pystat.2@gmail.com`, git-linked to `main` for continuous deployment.
When checking/confirming deploys (autopilot routine: this means YOU), always use
this site id, not the old one.

---

## Goal 1: Evaluator schedule view — "import the group and start evaluating"

**Status: DONE** (2026-09-15) — `/schedule` page, `getEvaluatorSchedule()` in
`src/lib/models/evaluators.ts`, roster import via `listActiveStudentsInGroup()`.
Nav link added to `(evaluator)/layout.tsx`.

Evaluators currently only see `/my` (today's scoped students, flat list — added in the
rotation-enforcement work). Add a schedule-first view: an evaluator-facing page showing
their own upcoming/past rotation stints (which group, which hospital, which dates —
mirrors the admin `/setup` Gantt timeline but scoped to just this evaluator's
assignments), so they can see their whole rotation at a glance and jump straight into
grading any of their scheduled groups, not just whoever's scheduled *today*.

Plan:
- [ ] New model function: resolve an evaluator's own rotation stints (their
      `EvaluatorAssignment` rows → matching `RotationBlock`s for those groups/hospitals)
- [ ] New page e.g. `/schedule` in the `(evaluator)` route group
- [ ] Each stint links into the existing `/grade/[studentId]` flow (or a new
      "grade this group now" list) — respecting the existing schedule enforcement
      (`getScheduledRotationForDate`, `canEvaluatorGradeGroupAtHospital`) already built
- [ ] Add nav link in `(evaluator)/layout.tsx`

## Goal 2: Zero data loss — permanent storage, Google-account-linked

**Status: OAuth flow DONE** (2026-09-15). Credentials received from the user
(2026-09-15) and set as Netlify env vars `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
(secret-scoped — never written to any file in this repo, never logged here).

Decisions (2026-09-15):
- Google Sign-In is **added alongside** email+password, not a replacement.
- Google login only ever signs in to an **existing** account (matched by email,
  linked on first successful sign-in) — it never creates a new account. Preserves
  the admin-provisioned account model; no self-registration via Google.

Implemented:
- [x] Added `googleId` (nullable, unique) to `Account` in schema.prisma — migration
      `20260915000900_add_google_signin`, additive only, applied to production
- [x] `GET /api/auth/google` — redirects to Google's consent screen, CSRF state
      cookie
- [x] `GET /api/auth/google/callback` — exchanges code, verifies `email_verified`,
      finds-or-links the Account by email, issues the same JWT session cookie
      `signSession()`/`SESSION_COOKIE` that email+password login uses, redirects by
      role same as `loginAction`
- [x] "الدخول باستخدام Google" button on `/login`, with a translated error banner
      for each failure mode (no matching account, already linked elsewhere, etc.)

Not yet done:
- [ ] Verify live end-to-end (needs a real Google account to click through — could
      not fully test from an unattended/automated context; a human should try it
      once against `https://eva-v3-app.netlify.app/login` and report back)
- [ ] Account-linking UI: an already-logged-in user (email+password) can link their
      Google account from a settings page, rather than only at first sign-in with
      matching email (nice-to-have, not blocking)

Also queued, independent of the OAuth work (not started yet):
- [ ] Verify Neon's backup/PITR settings on the current plan and document them
- [ ] Add a scheduled export/backup routine (nightly `pg_dump` or Neon branch
      snapshot) so "zero data loss" has a concrete mechanism
- [ ] Audit that every grade-write path is transactional (already true for
      `upsertEvaluation` — confirm no other write path regressed this)

## Goal 3: Evaluator — download the day's detailed evaluation as Excel

**Status: DONE** (2026-09-15) — `GET /api/my/export?date=YYYY-MM-DD` using
`exceljs`, button on `/my`. Full per-rubric-section columns, not just totals.

An evaluator should be able to download an `.xlsx` of a given day's evaluations they
did (or are scheduled for) — full per-criterion detail, not just totals, matching the
Grading Center's level of detail.

Plan:
- [ ] Pick an Excel library (`exceljs` — no native deps, works in Netlify's
      serverless runtime; avoid `xlsx`/SheetJS's older license/CVE baggage)
- [ ] New route handler e.g. `/api/evaluations/export?date=YYYY-MM-DD` (or a
      server action returning a file) scoped to the logged-in evaluator's own
      graded students for that date
- [ ] Columns: student name/code/university number, hospital, attendance, each
      rubric section's score, total, notes/feedback
- [ ] Add a "تنزيل تقرير اليوم (Excel)" button on `/my` (or the new `/schedule` page)

## Goal 4: Offline-capable evaluation, sync when back online

**Status: CODE-COMPLETE (2026-09-15) — all of Phases 4a-4d are implemented,
type-checked, build-verified, and pushed to `main`. Production deploy is
stuck on the Phase 4c commit (`ea5ea1f`) — the site's auto-deploy has not
picked up any commit since, across two consecutive autonomous sessions;
needs a human to check `eva-v3-app-gsfa`'s Build & deploy settings. True
Background Sync API registration deliberately not attempted (see Phase 4d
notes). No further autonomous code work remains in Goal 4 — see the
2026-09-15 "Autonomous queue check" Session Log entry.**

Decision: full offline capability — works with zero connectivity for hours, not just
resilient to brief drops. This is a genuinely large, multi-session build. Phased plan:

**Phase 4a — PWA shell (installable, static-asset offline)** — DONE (2026-09-14)
- [x] `manifest.json` + icons, service worker registration — `src/app/manifest.ts`
      (start_url `/my`, brand-colored icons at `public/icon-192.png` /
      `icon-512.png`), registered from `src/app/sw-register.tsx` in the root
      layout.
- [x] Service worker caches the evaluator app shell (JS/CSS) so the app *opens*
      offline, even before any data work — `public/sw.js`: precaches
      `public/offline.html` + icons, cache-first for `/_next/static/*`,
      network-first-with-offline-fallback for navigations. Deliberately does
      **not** cache dynamic/personalized HTML yet (grades, schedules) — that's
      explicit IndexedDB work in 4b/4c, not implicit HTTP caching.

**Phase 4b — "Import once": local data cache** — DONE (2026-09-15, code; not yet
verified live — deploy pipeline is currently broken, see Session Log)
- [x] IndexedDB store (via a small wrapper, `idb`) for: the evaluator's
      schedule (`getEvaluatorSchedule` result), each stint's student roster, the
      active rubric sections (`listRubricSections`), and any already-saved
      evaluations for context — `src/lib/offline/db.ts`
- [x] An explicit "استيراد الجدول للعمل دون اتصال" (import schedule for offline
      work) action on `/schedule` that fetches all of the above and populates
      IndexedDB in one shot — `GET /api/schedule/offline-bundle` +
      `import-offline-button.tsx`

**Phase 4c — Offline-first grading UI** — DONE (2026-09-15, code; not yet
verified live — see Session Log)
- [x] `/grade/[studentId]` reads from IndexedDB when offline (detect via
      `navigator.onLine` + actual fetch failure, not just the flag) instead of
      failing on the server component fetch — converted to a Client Component,
      new `GET /api/grade/[studentId]` (JSON twin of the old server-fetch
      logic), `src/lib/offline/gradeData.ts` rebuilds the same view from the
      Phase 4b IndexedDB cache when the fetch fails
- [x] Grade submission writes to a local outbox (IndexedDB) instead of calling the
      server action directly when offline; UI shows "محفوظ محليًا — سيُزامن عند
      الاتصال" (saved locally — will sync when online) — `outbox` store added to
      `src/lib/offline/db.ts` (DB v2), page tries `gradeStudentAction` first and
      only queues locally on an actual network failure

**Phase 4d — Sync queue** — online-event flush DONE (2026-09-15, code; not yet
independently verified live — see Session Log); Background Sync API itself
explicitly not attempted (decision below)
- [x] Sync replays the outbox through the *existing* `gradeStudentAction`/
      `upsertEvaluation` — `src/lib/offline/sync.ts`'s `replayOutbox()`,
      triggered on mount and on the `online` event by a new always-mounted
      `OfflineSyncStatus` component in `(evaluator)/layout.tsx`, plus a manual
      "زامن الآن" button. **Decision: true Background Sync API (firing with
      the app closed) is deliberately not implemented** — it would need a
      plain fetch/POST endpoint the service worker can call without Next's
      Server Action wiring (a second write path to keep in sync with
      `gradeStudentAction`, more surface area for a grades-safety bug), and
      has no Safari/iOS support anyway. The `online`-event + manual-button
      path covers the realistic reconnect case (app open or backgrounded)
      and is the one the plan already named as an acceptable fallback — if a
      human wants true background-sync-while-closed later, revisit then.
- [x] Conflict handling: **decided — last-write-wins**, matching
      `upsertEvaluation`'s existing upsert-by-(studentId, dateISO) behavior
      unchanged (no code change needed). Accepted for a single evaluator's
      own queued writes; a cross-device same-evaluator-same-day-both-offline
      conflict remains a known, accepted edge case (not a merge-prompt UI) —
      revisit only if this actually causes a reported data problem.
- [x] Rubric-changed handling: before resubmitting a queued entry, `sync.ts`
      re-fetches `/api/grade/[studentId]` (the same endpoint the online form
      uses) and compares its current rubric section ids against the ids the
      queued entry has scores for. A currently-active section missing from
      the queued scores (added while the evaluator was offline) blocks that
      entry with a clear error surfaced in the evaluator UI instead of
      silently submitting a 0 for a section they never saw; a scope/schedule
      change (evaluator no longer covers this student/day) is surfaced the
      same way instead of guessed at. Sections removed from the rubric are
      simply not in `gradeStudentAction`'s FormData lookup and are dropped
      the same way the server already drops unknown form fields — no special
      handling needed for that direction.

Not started — Goals 1 and 3 (done) and the Google auth wiring (pending credentials)
take priority since they're smaller and don't block on anything. Start 4a once those
are clear.

## Open questions for the user

1. ~~Google Sign-In: replace or add alongside email/password?~~ **Answered: alongside.**
2. ~~Google OAuth client ID + secret~~ **Received 2026-09-15, set as Netlify env vars.**
3. ~~Offline: lightweight retry-queue, or full PWA/local-database?~~ **Answered: full PWA.**

## ⚠️ NEEDS HUMAN ACTION — Google Sign-In will fail on the new domain until this is done

The registered OAuth redirect URI in Google Cloud Console is still
`https://eva-v3-app.netlify.app/api/auth/google/callback` (the OLD, now-dormant
site). The canonical site is now `eva-v3-app-gsfa.netlify.app` — Google will
reject the login with a `redirect_uri_mismatch` error until a second redirect URI
is added for the new domain:
```
https://eva-v3-app-gsfa.netlify.app/api/auth/google/callback
```
Add this at https://console.cloud.google.com/apis/credentials → the OAuth client
→ Authorized redirect URIs → **+ Add URI** (don't remove the old one, just add
this as a second entry). Email+password login is unaffected and already verified
working on the new site — only Google Sign-In needs this.

No open questions remain — Goal 2's OAuth flow is implemented (needs a human to
click through it once to confirm live), Goal 4's PWA build is the
`eva-goals-autopilot` cloud routine's job now.

---

## Session Log

_Newest entry on top. One entry per work session — what was done, what's next._

### 2026-09-15 — Autonomous queue check: Goal 4 fully code-complete, nothing left to build
- Autonomous run. Repo was in a detached-HEAD state at session start again
  (same recurring pattern noted in several prior entries). This time it
  turned out to be a stale local `origin/main` ref rather than lost work:
  `git fetch origin` alone brought `origin/main` forward from `1af1817` to
  `82d3384` (25 commits) with no divergence — `ls-remote` confirmed
  `refs/heads/main` on the remote matches the detached HEAD exactly. Checked
  out `main` and reset it to match `origin/main`; no data was ever at risk,
  this was just this container's local ref being behind.
- Read this file in full, including the Session Log. Confirmed every
  checklist item in Goal 4 Phases 4a, 4b, 4c, and 4d is already checked
  `[x]` — there is no next unchecked step in the phased plan to pick up.
  Made zero code changes this run, and correspondingly made zero
  Neon/database calls and touched no Prisma/migration files, per the hard
  safety rule (nothing to build meant nothing to risk).
- Per the hard safety rules, re-checked the deploy before concluding
  anything: `netlify-project-services-reader get-project` on
  `61860730-67b5-4418-81bf-a89c30900e45` (`eva-v3-app-gsfa`) still shows
  `currentDeploy` = `6aa8a74483196d000869afc3`, and
  `netlify-deploy-services-reader get-deploy-for-site` confirms its
  `commit_ref` is still `ea5ea1f...` (Phase 4c), `state: ready`, no
  `error_message`. **No new deploy has fired for any commit since
  `ea5ea1f`** — not for `b6e45af`/`ea5ea1f` (already confirmed live last
  session) nor for the Phase 4d commits (`2ca3ce5`, `82d3384`) the previous
  session pushed and flagged as stuck. This is the same "auto-deploy
  trigger isn't firing for this repo's pushes" symptom already documented
  in the 2026-09-15 Phase 4d entry below, now confirmed to still be true a
  full cycle later with zero change — i.e. it is not a transient timing
  issue, the site's GitHub link/webhook genuinely appears stuck. Did not
  touch any Netlify setting (read-only checks only), per the hard rule.
- **Conclusion: the autonomous work queue for Goal 4 is empty.** All four
  phases are code-complete, type-checked, build-verified, and pushed to
  `main`/`origin/main`. What remains is entirely outside this routine's
  scope per its own instructions:
  1. **Needs a human, Netlify dashboard**: `eva-v3-app-gsfa`'s Build & deploy
     settings — confirm the GitHub repo link/webhook is still active and, if
     needed, manually trigger a deploy for `82d3384` (or later) to get Phase
     4d live. This has now been flagged across two consecutive sessions
     without a new deploy appearing in between.
  2. **Needs a human, Google Cloud Console**: the redirect-URI fix already
     flagged at the top of this file (Goal 2 is otherwise done).
  3. **Needs a human with a browser**: end-to-end click-through testing of
     both the Google Sign-In flow and the full offline PWA flow (import →
     go offline → grade → reconnect → confirm sync) — no browser or logged-in
     session available in this sandbox for any session so far.
  4. Goal 2's two remaining "queued, independent of OAuth" items (Neon
     backup/PITR verification, a scheduled export routine) are ops/backup
     policy decisions this file itself scopes as "not something to implement
     unprompted" — left untouched, not invented as new work.
  Per this run's own instructions, doing nothing further and not inventing
  new scope. **Future hourly runs should not re-investigate this from
  scratch** — if the deploy `commit_ref` at
  `61860730-67b5-4418-81bf-a89c30900e45` is still `ea5ea1f` and this file's
  Goal 4 checklist is still all `[x]`, the correct action is the same as
  this entry's: confirm nothing changed, note it tersely (or skip logging
  entirely if truly nothing changed), and stop rather than re-deriving this
  finding every hour. Only act again once either (a) a human unblocks the
  deploy and it's worth verifying live, or (b) this file gains new unchecked
  scope for a human has added.

### 2026-09-15 — Goal 4 Phase 4d shipped (code): outbox sync queue
- **Deploy check: pushed as commit `2ca3ce5`, but the site's auto-deploy did
  not pick it up within this run's polling window** (~8+ minutes, repeated
  `get-project` polls on `eva-v3-app-gsfa` / `61860730-...`). `currentDeploy`
  stayed on the previous deploy the whole time — commit `ea5ea1f` (the tip
  before this session's push), state `ready`, no `error_message`. This is
  the same "auto-deploy trigger itself didn't fire for this push" pattern
  already documented in the 2026-09-14 Phase 4a entry, not a build failure:
  nothing errored, production is simply still serving the last good deploy
  (stale, not broken). Per the hard safety rules, did not force a manual
  deploy or touch any Netlify setting — read-only status checks only. **A
  human should check `eva-v3-app-gsfa`'s Build & deploy settings (is the
  GitHub webhook/repo link still active?) and, if needed, trigger a manual
  deploy for `2ca3ce5` from the Netlify dashboard.** The next autonomous run
  should re-check `get-project`/`get-deploy-for-site` for this commit before
  assuming anything about whether 4d is actually live.
- Autonomous run. Repo's local `main` was on a stale fetch of `origin/main`
  again at session start (same recurring pattern as prior sessions' notes) —
  re-fetched, confirmed `origin/main` and the pre-existing detached HEAD
  were identical both ways via `git merge-base --is-ancestor`, then
  fast-forwarded local `main` to match. No divergent/lost work.
- Confirmed via this file that Goal 2 (Google OAuth) is DONE per the hard
  rule — did not touch its code. Made zero Neon/database/Prisma calls or
  commands, per the hard safety rule; this phase is pure client-side/API-
  route work as expected.
- Read `node_modules/next/dist/docs/01-app/02-guides/offline-support.md`
  first per `AGENTS.md` (again, since `node_modules` isn't committed and
  `npm install` was needed this run too). Re-confirmed `experimental.
  useOffline` (auto-retry of a pending Server Action once connectivity
  returns, no throw) is a genuinely different mechanism from what this
  phase needed — it would fight with Phase 4c's existing catch-and-queue
  design (which needs the action to actually reject on a network failure so
  it can fall back to the local outbox) rather than help it, so left
  `next.config.ts` untouched, consistent with the standing decision.
- Implemented Phase 4d's sync queue:
  - `src/lib/offline/sync.ts` (new): `replayOutbox()` reads every queued
    `OutboxEntry`, re-validates each one against `GET /api/grade/[studentId]`
    (the same endpoint the online grading page already uses) before
    resubmitting — this re-checks scope/schedule (which may have changed
    server-side since the entry was queued) and detects a rubric section
    added while offline that the queued entry has no score for, surfacing a
    clear Arabic error instead of silently sending `0` for it or guessing.
    A passing entry is submitted via the *existing* `gradeStudentAction`
    (built into a `FormData`, same shape the online form already posts) —
    no second/parallel write path, so all of `assertEvaluatorCanGrade` and
    `upsertEvaluation`'s existing enforcement applies unchanged. A network
    failure (`TypeError`, or `navigator.onLine` flipping false) stops the
    whole pass immediately (still offline — try again next trigger) rather
    than marking every remaining item an error.
  - `src/lib/offline/db.ts`: added `error?: string` to `OutboxEntry`, plus
    `listOutboxEntries`/`removeOutboxEntry`/`setOutboxEntryError` helpers.
    `queueOutboxEntry` now clears any stale `error` on a fresh resubmission.
  - `src/app/(evaluator)/offline-sync-status.tsx` (new): a small status strip
    mounted once in `(evaluator)/layout.tsx` (visible on every evaluator
    page, not just the grading form) — shows the pending/errored outbox
    count, a manual "زامن الآن" button, and links each errored entry to its
    `/grade/[studentId]` form for manual review. Triggers `replayOutbox()`
    on mount and on the browser `online` event.
  - **Decision, documented in Goal 4 above**: true Background Sync API
    (fires even with the app fully closed) is deliberately not attempted —
    it would need a plain POST endpoint callable from a bare service-worker
    context without Next's Server Action wiring, meaning a second write path
    to keep bug-for-bug identical to `gradeStudentAction` forever, which is
    more risk than a "sync when back online" checklist item justifies on an
    app whose one hard rule is zero grade data loss; it also has no iOS/
    Safari support. The online-event + manual-button path is the fallback
    the plan itself named as acceptable and covers the realistic case
    (evaluator's connection returns while the app is open or backgrounded).
  - **Decision, documented in Goal 4 above**: conflict handling stays
    last-write-wins (no code change — this is `upsertEvaluation`'s existing
    behavior). Cross-device double-offline conflicts remain a known, accepted
    edge case rather than a merge-prompt UI, per the plan's own framing of
    that as the acceptable default.
  - Known minor UX gap, not a data-safety issue: if an evaluator is actively
    on a student's `/grade/[studentId]` page when the layout-level sync
    strip syncs that same entry in the background, that page's own
    `saveStatus` banner ("محفوظ محليًا") doesn't live-update to "synced" —
    it's stale until reload/renavigation, since there's no cross-component
    event bus wiring it up. The grade itself is safely saved server-side
    either way; only the on-screen label lags. Worth fixing later with a
    shared event emitter or a `BroadcastChannel`, not urgent.
- `npm install` (node_modules missing this run again — not committed, as
  expected), `npx next build` clean (zero errors, route table unchanged
  except this doesn't add any new route — sync logic is client-side/reuses
  existing routes), then `npx tsc --noEmit` clean (needed the build to run
  first for `.next/types`, same pre-existing quirk noted in earlier
  entries). Smoke-tested with `next start`: `/login`, `/manifest.webmanifest`,
  `/sw.js` still 200, `/api/grade/nonexistent` still 401s unauthenticated,
  `/grade/nonexistent` still 307-redirects to `/login` — no regression to
  the existing auth/offline shell. Did not browser-test the actual sync
  flow end-to-end (queue an entry offline, go back online, watch it
  disappear from the outbox) — would need a logged-in evaluator session
  with real roster/rubric data and DevTools' offline throttling, not
  available in this sandbox, consistent with how every previous Goal 4
  phase's testing was scoped here.
- Checked `git status` before staging — only the four intended files
  (`src/lib/offline/db.ts`, new `src/lib/offline/sync.ts`, new
  `src/app/(evaluator)/offline-sync-status.tsx`, `(evaluator)/layout.tsx`)
  plus this file. No stray files, no dependency changes.
- **Next step:** Goal 4's phased plan (4a-4d) is now code-complete except
  for the deliberately-deferred Background Sync API piece (see decision
  above — not planned unless a human asks for it specifically). What's left
  for a human, not the autopilot: (1) the Google Sign-In redirect URI still
  flagged at the top of this file, (2) browser-testing the full offline
  flow end-to-end at least once (import → go offline → grade → reconnect →
  confirm it syncs and the outbox empties) since no run of this routine has
  had a real browser + logged-in session to do that with, (3) the two
  "queued, independent of the OAuth work" Goal 2 items (Neon backup/PITR
  verification, a scheduled export routine) which are the only remaining
  unchecked work in this file's active goals and are backup/ops decisions,
  not something to implement unprompted. If the next run finds nothing
  else queued, it should say so per its instructions rather than inventing
  new scope.

### 2026-09-15 — Goal 4 Phase 4c shipped (code): offline-first grading UI
- Autonomous run. Repo was on a detached HEAD at session start pointing at a
  stale local fetch of `origin/main` (same pattern as a previous session's
  note) — re-fetched, confirmed `origin/main` and the detached HEAD were
  actually identical (`git merge-base --is-ancestor` both directions), then
  checked out `main` and fast-forwarded it to match. No divergent/lost work.
- Goal 2 (Google OAuth) — untouched, per hard rule. Did not call any
  Neon/database tool and made zero schema/migration changes, per the hard
  safety rule — this phase is pure client-side/API-route work.
- Read `node_modules/next/dist/docs/01-app/02-guides/offline-support.md`
  first per `AGENTS.md`. Confirmed a load-bearing fact for this phase's
  design: even this Next version's built-in `experimental.useOffline`
  mechanism explicitly does **not** cover a full/cold page load offline
  ("A full page reload while offline still fails because the browser needs
  the network to deliver the HTML; full offline loads would need a service
  worker") — it only helps soft navigations into already-prefetched routes
  and Server Action retries. This confirmed the IndexedDB-cache approach
  already scoped in this file for 4b/4c (not `useOffline`) is the correct
  mechanism, and that the site's `next.config.ts` correctly does not enable
  that experimental flag — left it untouched.
- Implemented Phase 4c in full:
  - `GET /api/grade/[studentId]` (new route): a JSON twin of the old
    `/grade/[studentId]` Server Component's data-fetch — same checks, same
    order (student exists → evaluator's scope → schedule → hospital
    coverage) as `page.tsx` and `gradeStudentAction`'s
    `assertEvaluatorCanGrade` used to duplicate between themselves anyway.
  - `src/lib/offline/gradeData.ts`: rebuilds the identical view-model from
    the Phase 4b IndexedDB cache when the network fetch fails — finds the
    student across cached rosters (rosters are keyed by groupId; a hit
    doubles as the offline "in scope" check), matches today's date against
    the cached schedule's stints using the *same* pure `isDateInScheduledDays`
    helper the server uses (`src/lib/weekdays.ts`, no DB dependency, safe to
    import client-side) — and because `getEvaluatorSchedule` only ever
    returns stints the evaluator's own assignments actually cover, a
    matching stint offline already implies "hospital covered" too, so there's
    one fewer failure case offline than online (no `not_covered`, only
    `out_of_scope`/`not_scheduled`) — documented in the module comment rather
    than left implicit.
  - `src/app/(evaluator)/grade/[studentId]/page.tsx`: converted from an
    `async` Server Component to a Client Component (`useParams` for the
    dynamic segment). On mount: skip straight to the offline path if
    `navigator.onLine === false`; otherwise try the fetch and only fall back
    to `loadOfflineGradeData` on an actual thrown fetch failure — i.e. both
    signals from the plan, not just the flag. All the original inline error
    states (out of scope / not scheduled / not covered / not found) are
    preserved verbatim, just driven by state instead of server props.
  - `outbox` object store added to `src/lib/offline/db.ts` (bumped
    `DB_VERSION` 1→2, upgrade guarded with `objectStoreNames.contains(...)`
    checks so an evaluator's existing v1 database upgrades in place without
    erroring on stores that already exist). On submit: try
    `gradeStudentAction` directly (a "use server" action can be called as a
    plain async function from a Client Component, not just via
    `<form action=>`) first; only on a real network failure (`TypeError`
    from the underlying fetch, or `navigator.onLine` having gone false
    mid-session) does it queue to the outbox instead — a real
    validation/authorization error the action throws is shown to the user,
    not silently swallowed into a local save. Success shows "محفوظ محليًا —
    سيُزامن عند الاتصال" per the plan's exact wording. Reopening the form
    offline prefers a queued-but-unsynced outbox entry over the last-known
    server evaluation, so in-progress offline edits aren't lost by
    re-rendering from stale imported data.
  - Actually *replaying* the outbox through the server (background sync) is
    explicitly Phase 4d, not this phase — untouched here, matches the plan.
- Known, deliberate limitation carried over from how Phase 4a's service
  worker is scoped (not a regression from this session): this only helps
  once the evaluator has already navigated into the `(evaluator)` route
  group at least once while online this session/cache-lifetime (so the
  shared layout's session check and this route's JS chunk are already
  loaded/cached) — a genuinely cold, first-ever offline page load straight
  to `/grade/[id]` still can't render, same as `/my` or `/schedule` already
  couldn't before this phase. Solving that fully would mean caching the
  personalized app-shell HTML itself, which Phase 4a's service worker
  comment explicitly deferred to "explicit IndexedDB work," not implicit
  HTTP caching — left as-is, consistent with that earlier decision.
- `npm install` (node_modules was missing this run), `npx next build` clean
  (zero errors; new route `/api/grade/[studentId]` listed in the route
  table; this also regenerates `.next/types` which a fresh `tsc --noEmit`
  needs — the pre-existing `LayoutProps` global type it provides made a raw
  `tsc --noEmit` on a from-scratch checkout error before the first build,
  unrelated to this session's changes), then `npx tsc --noEmit` clean.
  Smoke-tested with `next start`: `/login`, `/manifest.webmanifest`,
  `/offline.html`, `/sw.js` still 200 (no regression to the existing PWA
  shell); `GET /api/grade/nonexistent` correctly 401s unauthenticated
  (matches the `/api/schedule/offline-bundle` pattern); a cold
  `/grade/nonexistent` request still 307-redirects to `/login`, confirming
  the `(evaluator)/layout.tsx` server-side session gate still runs and this
  change didn't weaken it. Did not browser-test the actual offline
  read/outbox-write flow end-to-end (would need a logged-in evaluator
  session with real roster/rubric data and DevTools' offline throttling —
  not available in this sandbox, no DB access here either, consistent with
  how previous sessions' smoke-testing was scoped).
- Checked `git status` before staging — only the four intended files
  (`src/lib/offline/db.ts`, new `src/lib/offline/gradeData.ts`, new
  `src/app/api/grade/[studentId]/route.ts`, and the rewritten
  `src/app/(evaluator)/grade/[studentId]/page.tsx`) plus this file. No stray
  files, no `package.json`/`package-lock.json` changes (no new dependency
  needed — reused the existing `idb` wrapper).
- **Deploy confirmed live**: pushed as commit `b6e45af`. Polled
  `eva-v3-app-gsfa` (site `61860730-67b5-4418-81bf-a89c30900e45`) via
  `get-project`/`get-deploy-for-site` — new deploy `6aa8a5d0...` reached
  `state: ready` in 70s, `commit_ref` matches `b6e45af` exactly, no
  `error_message`, build summary all green (function deployed, redirects/
  headers processed). Direct `curl` from this sandbox to the live URL itself
  was blocked by this environment's own egress policy (unrelated to
  Netlify/production — a sandbox network restriction, not a site problem);
  the Netlify API's deploy record is the authoritative source here and it's
  clean, so no further verification action needed this run.
- **Next step:** Goal 4 Phase 4d (sync queue) — replay the outbox through
  `gradeStudentAction` on an `online` event / Background Sync API, and the
  two decisions this file already flags as needing a revisit before shipping
  it (cross-device last-write-wins conflict handling; validate/remap if the
  rubric changed on the server while an evaluator was offline). Also worth a
  human's attention whenever they're next in the app: browser-test 4b+4c's
  actual offline flow once (import the schedule while online, go offline,
  open a scheduled student's grading form, confirm it renders from cache and
  a submitted grade shows "محفوظ محليًا").

### 2026-09-15 — Migrated to a new Netlify site; deploy is fixed and verified live
- Root cause of the deploy pipeline being broken (both the original site's
  "account credit usage exceeded" AND the GitHub Actions workflow's
  `JSONHTTPError: Forbidden`, noted in the entry below as unexplained): the
  Netlify **team** (`BlueSky`, Free plan, account `ammar.abd2000@...`) was
  quota-locked account-wide. Confirmed via `get-team` (plan: Free, user is
  sole Owner — ruling out a permissions/role explanation) and by testing a
  fresh personal access token (still `Forbidden` on deploy, even though
  `netlify build` with that same token succeeded) — the block applies to
  deploy-writes specifically, regardless of auth method or where the build
  ran. Building elsewhere (GitHub Actions) cannot route around an
  account-level lock enforced server-side by Netlify.
- User does not want to pay for more Netlify credits. Tried Render as a free
  alternative — blocked immediately by Render now requiring card verification
  even for free web services (`402 Payment information is required`).
- **Fix: migrated to a second, fresh Netlify account** (`pystat.2@gmail.com`
  — free tier, no card, same product, fresh quota bucket). New site
  `eva-v3-app-gsfa` (id `61860730-67b5-4418-81bf-a89c30900e45`), git-linked
  to this repo's `main` branch for continuous deployment, same as the
  original setup. **This is now the canonical live site** — updated the
  header of this file accordingly. The old site/account is left alone,
  dormant, not deleted (in case its quota resets and the user wants it back).
- Hit the exact same "DATABASE_URL not found at runtime" bug as the very
  first deploy of the original site, for the same reason: env vars set via
  the Netlify MCP tool report success but don't actually reach the function
  at runtime (this looks like a real, reproducible bug in that tool/connector
  path — happened identically on two separate Netlify accounts now). Fixed
  the same way as before: had the user add the 4 env vars (`DATABASE_URL`,
  `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) manually via the
  Netlify dashboard UI, which works reliably where the API tool doesn't.
- Diagnosed via the same temporary debug-shim technique as before
  (`loginAction` catch-and-return-real-error) — confirmed the exact error,
  then reverted the shim once fixed (commit `b7458dd`). Verified live:
  email+password login works end-to-end on the new site (admin login →
  `/dashboard` renders).
- **Did NOT verify Google Sign-In on the new domain** — flagged prominently
  above ("NEEDS HUMAN ACTION") because it needs a new redirect URI added in
  Google Cloud Console, which only the user can do.
- The GitHub Actions workflow (`.github/workflows/deploy.yml`) is now
  redundant (the new site's native git-linked deploy works and is simpler)
  but left in place, unchanged — harmless if it keeps failing against the
  old site's `NETLIFY_SITE_ID`, not worth spending a run's time on unless it
  becomes actively annoying (e.g. failure-notification noise).
- **Next step for the routine**: resume Goal 4 Phase 4c (offline-first
  grading UI) against the new site id noted at the top of this file. Before
  editing further, re-verify current deploy state on `eva-v3-app-gsfa`
  (`400fb70b...` is NOT this project anymore) — don't assume the last known
  state.

### 2026-09-15 — Goal 4 Phase 4b shipped (code); deploy pipeline still broken, new symptom
- Autonomous run. Repo was left in a detached-HEAD state pointing at a stale
  local fetch of `origin/main`; re-fetched and fast-forwarded local `main` to
  match `origin/main` (`c2652cf`) before doing anything — no divergent/lost
  work, just a stale local ref, confirmed via `git merge-base --is-ancestor`
  both ways before touching it.
- Goal 2 (Google OAuth) — untouched, per hard rule, regardless of credential
  status.
- Read `node_modules/next/dist/docs/01-app/02-guides/offline-support.md`
  first per `AGENTS.md`. Confirmed `experimental.useOffline`/`useOffline()`
  (soft-navigation/Server-Action retry) is a *different* mechanism from
  Phase 4b's explicit local cache — not a substitute for it — so proceeded
  with the IndexedDB plan as already scoped here.
- Implemented Phase 4b in full: `GET /api/schedule/offline-bundle` (new
  route, `requireRole("EVALUATOR")`-gated like the existing `/api/my/export`)
  returns the evaluator's schedule, each non-past stint's roster, the active
  rubric sections, and today's already-saved evaluations in one response;
  `src/lib/offline/db.ts` wraps IndexedDB via `idb` (added as a dependency —
  small, no native deps) with stores for schedule/rosters/rubricSections/
  evaluations plus an import-timestamp `meta` store; new client component
  `import-offline-button.tsx` on `/schedule` ("استيراد الجدول للعمل دون
  اتصال") fetches the bundle and writes it in, showing last-import time and
  error state. No schema/DB changes — confirmed no Neon/Prisma tool or
  command was touched, per the hard safety rule.
- `npm install` (node_modules was missing this run), `npx tsc --noEmit`
  clean, `npx next build` clean (zero errors, new route listed in the route
  table). Smoke-tested with `next start`: `/login` still 200s, and the new
  `/api/schedule/offline-bundle` correctly 401s unauthenticated (matches the
  existing `/api/my/export` auth pattern) rather than erroring. Did not
  browser-test the IndexedDB write itself (would need a logged-in evaluator
  session + real roster data) — flagging this as untested-in-browser, next
  step below.
- Committed only the intended files (checked `git status` before staging —
  no stray files) and pushed: commit `bc782ac` on `main`.
- **Deploy pipeline is still broken, but with a different symptom than last
  session's note.** Polled the GitHub Actions "Build and deploy to Netlify"
  workflow (`.github/workflows/deploy.yml`) for this push (run `34914835280`)
  and the one immediately before mine (run `34913377146`, commit `c2652cf`,
  from last session, before any of my code existed): **both fail identically**
  — `next build`/`netlify build` succeed fully (route table prints, zero
  errors), then the `npx netlify deploy --prod` step fails immediately with
  `JSONHTTPError: Forbidden`. This is **not the "account credit usage
  exceeded" error from before** — it's an authorization failure on the
  deploy-upload call itself, and it already failed on the pre-existing
  commit before my push, so **it is not caused by my code change**. Most
  likely cause: the `NETLIFY_AUTH_TOKEN` GitHub Actions secret (regenerated
  last session) either lacks permission for this specific site/team, or the
  regeneration didn't actually take/save correctly.
  - Confirmed via `netlify-project-services-reader get-project` that
    production is **not broken**, just stale: `currentDeploy` is still
    `6aa886b7a192600008ef1a77` (`ready`), the same old deploy from several
    sessions ago — nothing is 500ing, evaluators are just not seeing 4a/4b
    yet.
  - **Did not revert my commit.** The hard safety rule says revert on deploy
    failure to avoid leaving production broken — but production isn't
    broken here (still serving the last good deploy), and the identical
    failure already reproduced on the commit *before* mine with zero code
    involvement, so reverting would fix nothing and would only throw away
    working, type-checked, build-verified code. Did not touch any Netlify
    settings (read-only checks only), per the hard rule.
  - **Needs a human**: check that the `NETLIFY_AUTH_TOKEN` repo secret
    (GitHub → Settings → Secrets and variables → Actions) is a *fresh, valid*
    personal access token generated at
    https://app.netlify.com/user/applications#personal-access-tokens by an
    account that actually has deploy permission on the `eva-v3-app` site/team
    — re-paste it even if one is already set, since "Forbidden" (not
    "Unauthorized"/expired) suggests a scope/team mismatch rather than a
    missing token. Once fixed, the next autonomous run (or a manual
    `workflow_dispatch`/re-push) should confirm the deploy goes green and
    `currentDeploy`'s `commit_ref` catches up.
- **Mid-run, a live human push landed on `main`**: commit `e7fc7db` "TEMP:
  debug shim to surface real login error on new Netlify site" (by the repo
  owner, not this routine) — a temporary try/catch in `loginAction` that
  returns the real error message instead of the generic one, to debug login
  on what the commit message calls a "new Netlify site." Merged cleanly with
  this session's Phase 4b work (no conflicts, `git merge origin/main`,
  re-verified `tsc --noEmit` clean after) and pushed as `1ea24cd`. **Did not
  touch, revert, or "clean up" that debug shim** — it's someone else's
  in-progress work and still live on `main`; whoever added it should remove
  it once done debugging. The GitHub Actions deploy run for *that* commit
  (`952f7c6`, run `34914966184`) and for this session's merge commit
  (`1ea24cd`, run `34915174199`) **both also failed with the same
  `JSONHTTPError: Forbidden`**, confirming again this is pipeline-wide, not
  specific to any one commit's code.
  - The mention of a "new Netlify site" in that commit message may mean the
    repo owner is already aware the `eva-v3-app` site (`400fb70b-...`, the
    one this file and the GH Actions workflow are wired to) has a broken
    login/deploy story and is standing up a replacement — worth confirming
    with them directly rather than assuming; if so, the GH Actions
    workflow's hardcoded `NETLIFY_SITE_ID` and this file's site references
    would need updating to match, which is a decision for a human, not
    something to guess at here.
- **Next step:** once the deploy pipeline is confirmed working again (or
  pointed at whatever site the human is now using), verify 4a+4b live
  (installable PWA, offline-bundle import button on `/schedule` actually
  populating IndexedDB in a real browser). Either way, code-wise the next
  unit of work is Goal 4 Phase 4c (offline-first grading UI: read from
  IndexedDB when offline on `/grade/[studentId]`, local outbox for
  submissions) — should proceed with 4c next run regardless of deploy status,
  per last session's own guidance not to get stuck polling a deploy that
  can't succeed yet, and log the same "still broken, still not code's fault"
  finding tersely rather than re-investigating from scratch if it recurs
  unchanged.

### 2026-09-15 — Google Sign-In wired in
- Also set up and verified (via two capability tests) the `eva-goals-autopilot`
  cloud routine (trig_01Cy3PFo9Z5oF1HWJJyJrL24, hourly at :45) — confirmed it runs
  on genuinely independent cloud infrastructure (not the user's machine) and can
  push to this repo (required installing the Claude GitHub App for this repo,
  which the user did). It's working through Goal 4's phases autonomously now.
- User created the Google OAuth client and sent the Client ID/Secret. Set as
  Netlify env vars `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (secret-scoped).
- Implemented the full Google Sign-In flow: schema migration (additive `googleId`
  column), `/api/auth/google` + `/api/auth/google/callback` routes, login page
  button + error states. Google login only signs in to an existing
  admin-provisioned account (matched/linked by email) — never creates one.
- Migration applied to production (additive only, zero risk to existing rows).
- **Next step:** a human needs to actually click "الدخول باستخدام Google" on
  https://eva-v3-app.netlify.app/login once, with a real Google account matching
  an existing Eva account's email, to confirm the live flow end-to-end — this
  wasn't fully testable without a real Google account and browser interaction.
- **Root-caused and diagnosed the Netlify deploy issue flagged below**: it is
  NOT a webhook/GitHub-integration problem (the previous entry's hypothesis
  was wrong, corrected here). Tried a manual deploy trigger — it failed with
  `error_message: "Skipped due to account credit usage exceeded"`. **The
  Netlify team's build minutes/credits are exhausted** on this plan
  (`nf_team_dev`), almost certainly from the very high number of builds
  triggered across this long session (every push = a build). This blocks
  ALL deploys — auto and manual — until credits reset or the plan is
  upgraded, not just this one commit.
- **This directly affects `eva-goals-autopilot`**: it can keep committing
  working, buildable code, but none of it will actually go live until this
  is resolved. Code safety is unaffected (nothing is lost, just not
  deployed) but "confirm the deploy is ready" (a hard safety rule for that
  routine) will keep failing through no fault of the code itself.
- **User asked to avoid paying for more Netlify build minutes — fixed with
  a build-elsewhere pipeline instead.** Added `.github/workflows/deploy.yml`:
  builds on GitHub Actions' free runners (`netlify build`, using the
  existing `netlify.toml` config — no changes needed there) and only
  uploads the finished artifact with `netlify deploy --prod --no-build`.
  Netlify only meters builds that run on *their* infrastructure, not
  receiving a pre-built deploy, so this sidesteps the credit issue
  entirely going forward, independent of whether/when the exhausted
  credits reset.
  - **Needs one thing from the user to activate**: a Netlify **personal
    access token** (different from the OAuth session Claude uses) —
    generate one at https://app.netlify.com/user/applications#personal-access-tokens
    → "New access token" — then add it as a GitHub Actions secret named
    `NETLIFY_AUTH_TOKEN`: repo → **Settings → Secrets and variables →
    Actions → New repository secret**. The site ID is already hardcoded
    in the workflow (not sensitive, no secret needed for it).
  - Until that secret is added, the workflow will run on every push and
    fail at the `netlify build` step (expected, harmless) — future
    `eva-goals-autopilot` runs should note this rather than treating it
    as a code problem to fix.
  - Netlify's own git-linked auto-deploy is still connected and will keep
    trying (and being skipped for credits) in parallel — harmless, but the
    user may want to disable it in the Netlify dashboard (Site
    configuration → Build & deploy → "Stop builds") once the GitHub
    Actions pipeline is confirmed working, to keep things tidy.
- **Needs a human to resolve** — I cannot see Netlify billing/plan details
  or purchase more credits. Options: wait for the usage window to reset
  (check the Netlify dashboard for when), or upgrade the plan/add credits at
  https://app.netlify.com/projects/eva-v3-app (Site configuration → or team
  billing settings).
- **Until resolved**, `eva-goals-autopilot` should still make code progress
  (committing is still valuable — deploy will catch up once credits are
  available) but should NOT loop retrying the deploy-confirmation step for
  a long time each run if it sees this same "credit usage exceeded" error —
  note it in the log and move on rather than burning the whole run stuck
  polling a deploy that cannot succeed right now.

### 2026-09-14 — Goal 4 Phase 4a (PWA shell) shipped
- Autonomous run. Goal 2 (Google OAuth) still blocked — no
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` documented anywhere in this file —
  so it was skipped entirely, per this run's instructions.
- Read `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`
  and `offline-support.md` first, per `AGENTS.md`: confirmed this Next.js
  version's `manifest.ts` file convention and the experimental `useOffline`
  hook both behave as expected, and that `useOffline` alone does **not**
  cover a full offline app open (it only retries soft navigations/Server
  Actions) — a service worker is required for that, matching the Phase 4a
  plan already written here.
- Implemented Phase 4a in full: `src/app/manifest.ts` (installable manifest,
  `start_url: "/my"`), two brand-colored PNG icons generated locally (no new
  dependency — a small one-off Python/zlib script, not checked in),
  `public/sw.js` (precache + cache-first for `/_next/static/*` + offline
  fallback on failed navigations), `public/offline.html` (static branded
  offline page), `src/app/sw-register.tsx` wired into the root layout, plus
  `themeColor`/`icons` metadata. Fixed a stale comment in
  `(evaluator)/layout.tsx` that still said the PWA work was "scoped for
  Phase 3".
- No schema/DB changes (none needed for 4a, per the hard safety rules).
  Verified with `npx tsc --noEmit` (clean) and `npx next build` (clean, zero
  errors) — also smoke-tested with `next start`: `/manifest.webmanifest`,
  `/sw.js`, `/offline.html`, `/icon-192.png` all serve 200, and `/login`'s
  HTML includes the `<link rel="manifest">` and `<meta name="theme-color">`
  tags. Pushed to `main` after rebasing onto a concurrent push-capability
  test commit that landed on origin mid-session (see the entry below this
  one) — final pushed commit is `8cb600a`.
- **Deploy check (per the hard safety rules): did not confirm ready.**
  Polled Netlify (`get-project` on site `400fb70b-5646-424a-baf2-ae5cfd9e5e9b`)
  for ~10 minutes after the push. `currentDeploy` never changed from
  `6aa886b7a192600008ef1a77` (commit `1be92b9`, the *previous* push, which
  itself deployed fine in ~64s) — no new deploy for `8cb600a` ever appeared,
  successful or failed. This doesn't look like a build failure (nothing to
  revert — the previous deploy is still `ready` and serving, so production
  isn't broken); it looks like the auto-deploy trigger itself didn't fire
  for this push. Per the rules ("never touch Netlify settings beyond
  read-only status checks"), did not attempt to investigate further or
  force a deploy — flagged at the top of this log for a human to check the
  site's repository/webhook link in the Netlify dashboard.
- **Next step:** a human should confirm Netlify is picking up pushes to
  `main` again (check Build & deploy settings / trigger a manual deploy if
  needed) and verify Phase 4a actually goes live. Once that's confirmed,
  continue with Goal 4 Phase 4b ("Import once": IndexedDB store for the
  evaluator's schedule/roster/rubric via a small wrapper like `idb`, plus an
  explicit "استيراد الجدول للعمل دون اتصال" import action on `/schedule`).
  Goal 2 stays skipped until the user hands over the Google OAuth
  credentials.

### 2026-09-14 — Push-capability re-test
- Cloud routine push-capability re-test succeeded after GitHub App install.

### 2026-09-15 — Goals 1 & 3 shipped, Goal 2/4 scoped
- User answered the open questions: Google Sign-In added alongside existing auth
  (user provisions OAuth credentials and will hand them over); offline goal is a
  full PWA (zero-connectivity-for-hours), not a lightweight retry queue.
- Built and deployed Goal 1 (`/schedule` — evaluator's own rotation stints,
  past/current/future, roster import into grading) and Goal 3 (`GET
  /api/my/export?date=` — per-day Excel export via `exceljs`, full rubric-section
  detail). Commit `32fd7ad`, verified live (see below).
- Wrote the full Phase 4a–4d plan for the offline PWA into Goal 4 above — did not
  start building it yet; it's the largest remaining piece.
- **Next step:** waiting on Google OAuth credentials from the user to continue
  Goal 2. In the meantime, start Goal 4 Phase 4a (PWA shell: manifest + service
  worker + installable app shell) since it doesn't depend on anything blocked.

### 2026-09-15 — Session start
- Ran `/graphify` on the full repo: 417 nodes, 970 edges, 32 communities.
  Outputs in `graphify-out/` (graph.json, GRAPH_REPORT.md, graph.html). Committed
  to the repo so it persists across sessions/machines.
- Created this goals file with the 4 requested goals broken into concrete tasks.
- Flagged Goals 2 and 4 as blocked on user decisions (see "Open questions" above) —
  did not start implementation on those to avoid committing to the wrong architecture.
- **Next step:** get answers to the open questions; meanwhile start Goal 1
  (evaluator schedule view) and Goal 3 (Excel export) since both are unambiguous
  and don't require a decision from the user.
