# Eva v3 — Active Goals & Progress

**Read this file first in any new session before doing anything else.** It is the
persistent memory across context resets / session-limit restarts. After finishing
any task below, update its status and the "Session Log" at the bottom **before**
ending the turn — that is the mechanism that lets work continue across restarts.

Knowledge base: `graphify-out/GRAPH_REPORT.md` (human-readable) and
`graphify-out/graph.json` (queryable — `graphify query "<question>"`) hold a full
structural map of this codebase. Consult them before large changes; re-run
`graphify <path> --update` after significant structural changes so they stay current.

Live site: https://eva-v3-app.netlify.app · Repo: https://github.com/pystat-1/EvaRepo
Neon project: `dry-cell-81671466` (DB name `eva`) · Netlify site: `eva-v3-app` (id `400fb70b-5646-424a-baf2-ae5cfd9e5e9b`)

---

## Goal 1: Evaluator schedule view — "import the group and start evaluating"

**Status: NOT STARTED**

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

**Status: BLOCKED on user decision — see questions below**

This is flagged as the most important goal. Current state: Postgres on Neon (durable,
already has automated backups on Neon's side — verify retention/plan), email+password
auth with bcrypt + JWT session cookies. "Linked to their Google account" implies adding
Google OAuth, which is a real architecture decision, not a small tweak:

- Does Google Sign-In **replace** email+password, or is it **added alongside** it?
  (Replacing locks out anyone without a Google account — e.g. do all evaluators/students
  actually have one?)
- Who registers the OAuth client in Google Cloud Console? I cannot create Google Cloud
  credentials on your behalf — you (or someone with access) needs to create the OAuth
  consent screen + client ID/secret and hand me the credentials to wire in.
- Does "linked to their Google account" also mean: data should be exportable/portable
  per-account, or just that login goes through Google?

Until answered, safe/no-regret hardening I can do immediately without an architecture
decision:
- [ ] Verify Neon's backup/PITR settings on the current plan and document them
- [ ] Add a scheduled export/backup routine (e.g. nightly `pg_dump` or Neon branch
      snapshot) so "zero data loss" has a concrete mechanism, independent of the
      auth question
- [ ] Audit that every grade-write path is transactional (already true for
      `upsertEvaluation` — confirm no other write path regressed this)

## Goal 3: Evaluator — download the day's detailed evaluation as Excel

**Status: NOT STARTED**

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

**Status: BLOCKED on scope confirmation — see questions below**

Reading of the request: an evaluator downloads/imports their schedule + assigned
students once (while online), can then open the grading form and enter scores with
no network connection, and whatever was entered offline syncs to the server
automatically once connectivity returns.

This is a substantial architecture addition — the app is currently 100% server-rendered
(every page load and every grade save is a live request; there is no client-side data
layer at all). True offline support needs, at minimum:
- A service worker + PWA manifest (installable, works offline)
- A client-side store (IndexedDB) caching the evaluator's schedule + student list +
  rubric definition after the "import once" step
- Local-first grade entry UI (works fully offline, not just cached-read)
- A sync queue that replays queued writes through `upsertEvaluation` when back online,
  with real conflict handling (what if the same student/day was also graded from
  another device, or the rubric changed while offline?)

Before starting, need to confirm:
- Is this "resilient to brief connectivity drops" (a lighter retry/queue on top of the
  existing server-action flow) or genuinely "fully usable with zero connectivity for
  an extended period" (full PWA + local DB)? The engineering cost is very different.
- Is a rubric change while an evaluator is offline an edge case worth handling now, or
  deferrable?

## Open questions for the user

1. Google Sign-In: replace or add alongside email/password?
2. Who provisions the Google OAuth client (Cloud Console access)?
3. Offline: lightweight retry-queue, or full PWA/local-database?

---

## Session Log

_Newest entry on top. One entry per work session — what was done, what's next._

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
