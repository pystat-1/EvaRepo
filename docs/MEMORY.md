# Eva — Project Memory Hub

**Read this first in every new session.** Keep it short and current. Update facts in place and do not append status spam.

## Current state
- **Master plan:** `docs/FINAL_PLAN.md` (FINAL, 2026-09-28) consolidates everything and wins on conflicts. Awaiting user approval; nothing implemented.
- **Roadmap:** Phase 1 Planning ✅ → Phase 2 simple UI (U1–U6) → Phase 3 Database + engine (D1–D10) → Phase 4 Deployment (P1–P8)
- **Goal specs:** Course Setup (`COURSE_SETUP_PLAN.md`), Evaluator App (`EVALUATOR_APP_PLAN.md`), Grading Center (`GRADING_CENTER_PLAN.md`), Database (`DATABASE_DESIGN.md`)
- **Existing code:** Eva v3 (Next.js 16 + Prisma + Neon Postgres, deployed via Cloudflare Workers/OpenNext) is the base; tag `v3-final` before Phase 2

## Memory map
| File | What it holds |
|------|---------------|
| `docs/MEMORY.md` | This hub: state, key facts, decisions |
| `docs/FINAL_PLAN.md` | **Master plan**: product, decisions, modules, DB summary, tech, design, roadmap U/D/P steps, risks, open questions |
| `docs/PHASE_1_PLAN.md` | Goals, roles, sections, workflows, business rules, open questions |
| `docs/COURSE_SETUP_PLAN.md` | Big Goal 1: 8-step setup wizard, 10 matrix designs, publish flow, schema changes, build order S1–S9 |
| `docs/EVALUATOR_APP_PLAN.md` | Big Goal 2 FINAL: rulebook, data model, API, offline, reminders, design, risk register C1–C13 / P1–P19, build order E1–E10 |
| `docs/GRADING_CENTER_PLAN.md` | Big Goal 3: rotation-view grid (hospital→week→day), cell popover, journaled admin actions, zero-loss layers, free tool choices, attack G1–G25, build order G-1…G-10 |
| `docs/DATABASE_DESIGN.md` | Target database: 28 tables in 5 areas, mermaid ER diagram, DB-level guards. Interactive map: https://claude.ai/artifact/CS3HFH23NKoKt58aFkJTP8 |
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
| 2026-09-28 | Rubric snapshot modeled as a `RubricVersion` table (course → one version; sections belong to a version) | Design refinement in DATABASE_DESIGN.md |
| 2026-09-28 | Final master plan written; defaults adopted: Cairo font + Phosphor icons, Cloudflare Workers hosting, evolve current repo | FINAL_PLAN.md §3 |
| — | Open items: `FINAL_PLAN.md` §12 (final grade formula!, v3 data migration, hosting, Google Sign-In, icons, cell colors) | Awaiting user |
