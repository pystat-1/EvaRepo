# Eva v3 — Phase 1 + Phase 2 + Phase 3 (Database + Evaluators + Grading)

This implements all three phases from the project plan ("Eva v3 Rewrite
Plan"): Phase 1, the authoritative registry of students, groups, hospitals,
and study types; Phase 2, in-hospital evaluator accounts scoped to a
hospital (and optionally a specific group); and Phase 3, the grading system
— evaluators record daily scores against a data-driven rubric, the system
computes totals and flags at-risk students, and admins get statistics and
a student self-service portal. See the plan for the full architecture and
the reasoning behind each decision; this README is just how to run what's
here.

## Stack

Next.js (App Router) + TypeScript + Tailwind, server actions for all
mutations, bcrypt + JWT (httpOnly cookie) for auth, one shared Postgres
database in production (per the plan).

### The database: Prisma + Postgres (Neon)

This app now talks to Postgres through a real Prisma client
(`src/lib/db.ts` exports a singleton `PrismaClient`; every model under
`src/lib/models/*.ts`, plus `src/lib/audit.ts` and `src/lib/auth.ts`, calls
it). The schema lives at `prisma/schema.prisma`, with
`datasource db { provider = "postgresql" }`. `DATABASE_URL` must point at
a real Postgres instance — a Neon connection string in production.

This replaces the node:sqlite raw-SQL layer the app briefly ran on during
Phase 1–3 development: that layer existed only because the sandbox those
phases were built in blocks outbound access to `binaries.prisma.sh`, which
Prisma's CLI needs to download its query-engine binary, so `prisma
generate` couldn't run there. Deploying to Vercel + Neon removes that
restriction, so the raw-SQL layer has been retired in favor of the real
thing.

**Migrations**: `npm run db:migrate` runs `prisma migrate deploy` — the
production migration command. Run it against the target `DATABASE_URL`
before the app serves traffic on a fresh database (Vercel's build does
**not** run migrations automatically; wire it into your deploy pipeline,
e.g. a predeploy step, or run it by hand after setting `DATABASE_URL`).

**Generating the client**: `package.json` has `"postinstall": "prisma
generate"`, so `npm install` regenerates the client automatically —
including on every Vercel build. **Honesty note on verification**: this
Prisma conversion was written and reviewed in the same sandbox described
above, which still blocks `binaries.prisma.sh` — confirmed again while
doing this conversion (`npx prisma generate` fails there with a 403, even
with `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`; plain `npm install prisma
@prisma/client` from the npm registry does succeed, for what that's
worth). That means `@prisma/client` in this sandbox only ever contains its
un-generated stub, where `PrismaClient` and every model's types collapse
to `any` — so `npx tsc --noEmit` passing here is not proof this code is
correct against the real generated client, only that there are no *other*
type errors. The first real `prisma generate` — which will happen
automatically on Vercel's build via `postinstall` — is what actually
produces real types; re-run `npx tsc --noEmit` right after that (locally
or by reading a Vercel build log) and fix anything it newly reports before
trusting this layer with real data. Every converted file carries a
`TODO(verify-on-deploy)` comment saying the same thing at the point it
matters.

## Setup

```bash
npm install                # also runs `prisma generate` via postinstall
cp .env.example .env       # then set a real JWT_SECRET and a Postgres DATABASE_URL
npm run db:migrate         # applies the schema to that database
npm run seed                # creates an admin account + sample study types
npm run dev
```

Default seeded admin login (override via `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD` env vars before running `npm run seed`):

- email: `admin@eva.local`
- password: `ChangeMe123!`

**Change this password before using this anywhere near real data** — there
is no in-app "change password" screen yet (see Known gaps below); for now,
re-run the seed script against a fresh database with your own
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`, or update the `accounts` table
directly.

## What's here

- `/login` — admin login.
- `/dashboard` — record counts across the registry.
- `/students` — add students one at a time, or bulk-import/export via CSV.
  Identity is the university number, never the name (this is deliberate —
  see the plan's data-integrity reasoning). Re-importing a CSV with a
  university number that already exists updates that student instead of
  creating a duplicate.
- `/groups`, `/hospitals`, `/study-types` — the other registry entities,
  each with add + activate/deactivate.
- `/audit-log` — every create/update/deactivate across the registry,
  attributed to the account that made it.

CSV import columns: `universityNumber,nameAr,nameEn,email,studyType,group`.
`studyType` and `group` must match an existing name exactly (create them
first from their own pages).

### Phase 2 — Evaluators

- `/evaluators` (admin) — create evaluator accounts, each with a required
  hospital and an optional group (leaving group blank scopes the evaluator
  to every group at that hospital, current and future). Add further
  hospital/group assignments to an existing evaluator, and
  activate/deactivate both evaluator accounts and individual assignments.
- `/my` (evaluator) — the evaluator's own scoped view: only the students in
  their assigned hospital/group(s), nothing else. This is a read-only list
  for now; daily attendance/scoring is Phase 3.
- Scoping is resolved entirely server-side from the logged-in account's id
  (`getScopedGroupIds`/`getScopedStudents` in `src/lib/models/evaluators.ts`)
  — an evaluator account can never see another hospital's data no matter
  what the client sends, and is redirected away from every admin page.
  `scripts/smoke-test-phase2.mjs` specifically verifies this (creates two
  hospitals with one student each, an evaluator scoped to only one, and
  asserts the other hospital's student never appears).
- Login now redirects by role: `ADMIN` → `/dashboard`, `EVALUATOR` → `/my`.

### Phase 3 — Grading

- `/grade/[studentId]` (evaluator) — the daily attendance + scoring form,
  reached by tapping a student on `/my`. Attendance (present/late/absent),
  a score per rubric section, notes, and feedback. Re-opening the same
  student on the same day loads and edits today's existing entry rather
  than creating a second one.
- **The Tier 0 data-loss bug from the original app's data-integrity
  roadmap is fixed structurally, not patched:** the unit of write is one
  row per student per day (`evaluations`, `UNIQUE(studentId, dateISO)` in
  `src/lib/db.ts`), never a whole day's session object. Two evaluators
  grading two different students on the same day write two independent
  rows and cannot collide — there is nothing to blindly overwrite.
  `scripts/smoke-test-phase3.mjs` submits two evaluators' grading forms
  for two different students *concurrently* and asserts both saved.
- `/rubric` (admin) — the scoring rubric (seeded with the current app's
  15-point, 5-section rubric: Daily Note, Discussion & Feedback, Attitude &
  Communication, Punctuality, Appearance) as editable data, not a hardcoded
  template — add a section or change a max score without a redeploy.
- `/statistics` (admin) — evaluation counts and averages per hospital and
  per group, plus a per-group pass rate.
- `/flags` (admin), with an unread-count badge in the nav and on the
  dashboard — the three flag rules from the current app's engine
  (`src/lib/models/flags.ts`): 2+ evaluations below 60% of the rubric max,
  2+ recorded absences, or a declining least-squares trend over the last 5
  evaluations. Recomputed after every evaluation save; "reviewed" state
  survives recomputation.
- `/student-accounts` (admin) — create a login for a student (picked from
  the registry) so they can see their own data.
- `/me` (student) — the student's own evaluation history, scores, and any
  flags. Scoped server-side by the account's linked `studentId`, the same
  pattern as evaluator scoping; a student can never reach another
  student's data, or any admin/evaluator page.
- Login now also redirects `STUDENT` → `/me`.

## Environment variables

See `.env.example`. `JWT_SECRET` is required — the app throws at startup
if it's missing rather than falling back to a default (this was a real bug
found in a sibling project during the earlier audit; this app is written
specifically not to repeat it).

## Known gaps (fine for now, worth doing before production)

- No "change password" or "forgot password" UI — only the seed script sets
  a password today (evaluators and students are created with a plaintext
  initial password typed by the admin — fine to start, but a
  forced-change-on-first-login flow is worth adding before handing this to
  real evaluators/students).
- No pagination on the students/audit-log tables — fine at class-roster
  scale, will need it once a few cohorts have accumulated.
- Grading is hardcoded to today's date only — there is no UI for an
  evaluator to enter or correct a backdated evaluation (e.g. after a missed
  day). Would need an explicit "for this date" picker plus probably an
  admin-only override, since letting evaluators freely backdate invites
  abuse.
- `/rubric` supports adding a new section and toggling a section
  active/inactive, but there is no UI to edit an existing section's label
  or max score, even though `updateRubricSectionAction` already exists in
  `src/lib/actions/rubric.ts` — just needs a form. Sections also can't be
  deleted, only deactivated (deliberate, so historical scores keep their
  label — but worth documenting as intentional rather than missing).
- No offline/installable-PWA support for the Evaluator App yet (plan §2.4
  scopes that in once there's an actual daily workflow — grading — worth
  taking offline; that workflow now exists, so this is the natural next
  piece of work).
- No automated test suite wired into CI yet — the
  `scripts/smoke-test*.mjs` files are Playwright scripts used to verify
  this build manually (Phase 1 CRUD/import/export/audit, Phase 2's
  evaluator-scoping security check, and Phase 3's concurrent-grading +
  student-portal isolation checks). **Run each against a freshly seeded
  database** (reset the Postgres schema — e.g. `npx prisma migrate reset`
  against a disposable dev database — then `npm run seed`) — they are not
  written to be idempotent against each other's leftover data (e.g. Phase
  1's, Phase 2's, and Phase 3's scripts all create overlapping fixture
  names like "Nursing" or "Hospital A", which collide on a shared db).

## Scripts

- `npm run dev` — local dev server.
- `npm run build` / `npm run start` — production build/serve.
- `npm run seed` — create the initial admin account + sample study types.
