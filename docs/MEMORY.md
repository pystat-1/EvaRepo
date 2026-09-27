# Eva — Project Memory Hub

**Read this first in every new session.** Keep it short and current. Update facts in place and do not append status spam.

## Current state
- **Active phase:** Phase 1 — Planning (awaiting user approval of `docs/PHASE_1_PLAN.md`)
- **Active big goal:** Big Goal 1 — unified Course Setup wizard + rotation matrix + announced schedule (`docs/COURSE_SETUP_PLAN.md`, awaiting matrix design choice)
- **Active big goal:** Big Goal 2 — Evaluator app: shared evaluations, whole-course offline import, PWA, Excel (`docs/EVALUATOR_APP_PLAN.md`, FINAL plan, not implemented; build order S1–S9 then E1–E10)
- **Active big goal:** Big Goal 3 — Grading Center rebuilt from scratch (`docs/GRADING_CENTER_PLAN.md`, PLAN, not implemented; build order G-1…G-10). Overall order: S1–S9 → E1–E5 → G-1…G-10 → E6–E10
- **Plan:** rebuild ("Eva v4") from scratch in 4 phases: 1 Planning → 2 UI (simple) → 3 Database + data engine → 4 Deployment
- **Existing code:** Eva v3 (Next.js 16 + Prisma + Neon Postgres) is still in the repo as the reference implementation until the rebuild location is decided

## Memory map
| File | What it holds |
|------|---------------|
| `docs/MEMORY.md` | This hub: state, key facts, decisions |
| `docs/PHASE_1_PLAN.md` | Goals, roles, sections, workflows, business rules, open questions |
| `docs/COURSE_SETUP_PLAN.md` | Big Goal 1: 8-step setup wizard, 10 matrix designs, publish flow, schema changes, build order S1–S9 |
| `docs/EVALUATOR_APP_PLAN.md` | Big Goal 2 FINAL: rulebook, data model, API, offline, reminders, design, risk register C1–C13 / P1–P19, build order E1–E10 |
| `docs/GRADING_CENTER_PLAN.md` | Big Goal 3: rotation-view grid (hospital→week→day), cell popover, journaled admin actions, zero-loss layers, free tool choices, attack G1–G25, build order G-1…G-10 |
| `PROJECT_GOALS.md` | v3's historical goals and session log (legacy, reference only) |
| `prisma/schema.prisma` | v3 data model (reference for Phase 3) |

## Key facts (stable)
- Domain: nursing college clinical-rotation evaluation (University of Baghdad context), Arabic RTL UI
- Roles: ADMIN, EVALUATOR, STUDENT; accounts are admin-provisioned only
- Student identity = university number (never the name)
- One evaluation per (student, date); default rubric = 5+7+1+1+1 = 15
- Evaluators may grade only within their hospital/group scope and only on scheduled rotation days
- Top priority: zero grade loss
- Study type = shift (Morning / Evening) — user clarification 2026-09-27
- Shared evaluations: several evaluators per hospital; shared view shows ONLY who took which student (no grades)
- Two evaluators grade same student → both kept, DISPUTED, conflict flag to both evaluators + admin; admin approves one
- 7-day submit/sync window (Baghdad time) with reminders on day 0/3/5/6; late saves stored, admin may accept
- Evaluator may edit own evaluation until admin locks it
- Grading Center grid = rows students (banded by group, real dates in band header) × columns Hospital → stint week → attendance day; cell = day total; click → popover with criteria
- Grading Center tools: TanStack Table + Virtual + Query, shadcn/ui on Base UI, exceljs, NUMERIC(5,2) scores, pg_dump→Cloudflare R2 nightly backups (Neon free PITR = 6h only)
- Known v3 defects to fix (see EVALUATOR_APP_PLAN §C.1): broken offline navigation, Server-Action replay, outbox not per-account, silent overwrite by 2nd evaluator, no date window, NaN scores, no active-account check, UTC dates

## Decisions log
| Date | Decision | Status |
|------|----------|--------|
| 2026-09-27 | Rebuild in 4 phases, starting with planning | Agreed by user |
| 2026-09-27 | Big Goal 1 is built inside the existing v3 code (wizard writes the same RotationBlock/EvaluatorAssignment tables), not a from-scratch rewrite | Proposed by Claude, user granted full authority |
| 2026-09-27 | Course Setup: go with recommended options (D3+D10 matrix, D6 print, D1 per group); free/open-source tooling only | Agreed by user |
| 2026-09-27 | Evaluator app = offline-first shell `/e`, one versioned JSON write path, append-only submission journal, server-side sessions | Final plan |
| 2026-09-27 | Conflicts → admin approves one; shared view = who-took-whom only; 7-day window + reminders; edit until admin lock | Decided by user |
| 2026-09-27 | Do not implement yet — plan only | User instruction |
| 2026-09-28 | Grading Center rebuilt from scratch, not constrained by v3 structure | User instruction |
| — | Open items: `PHASE_1_PLAN.md` §10, `COURSE_SETUP_PLAN.md` §10, `GRADING_CENTER_PLAN.md` questions (final grade formula!) | Awaiting user |
