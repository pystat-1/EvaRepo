# Eva — Project Memory Hub

**Read this first in every new session.** Keep it short and current. Update facts in place and do not append status spam.

## Current state
- **Active phase:** Phase 1 — Planning (awaiting user approval of `docs/PHASE_1_PLAN.md`)
- **Plan:** rebuild ("Eva v4") from scratch in 4 phases: 1 Planning → 2 UI (simple) → 3 Database + data engine → 4 Deployment
- **Existing code:** Eva v3 (Next.js 16 + Prisma + Neon Postgres) is still in the repo as the reference implementation until the rebuild location is decided

## Memory map
| File | What it holds |
|------|---------------|
| `docs/MEMORY.md` | This hub: state, key facts, decisions |
| `docs/PHASE_1_PLAN.md` | Goals, roles, sections, workflows, business rules, open questions |
| `PROJECT_GOALS.md` | v3's historical goals and session log (legacy, reference only) |
| `prisma/schema.prisma` | v3 data model (reference for Phase 3) |

## Key facts (stable)
- Domain: nursing college clinical-rotation evaluation (University of Baghdad context), Arabic RTL UI
- Roles: ADMIN, EVALUATOR, STUDENT; accounts are admin-provisioned only
- Student identity = university number (never the name)
- One evaluation per (student, date); default rubric = 5+7+1+1+1 = 15
- Evaluators may grade only within their hospital/group scope and only on scheduled rotation days
- Top priority: zero grade loss

## Decisions log
| Date | Decision | Status |
|------|----------|--------|
| 2026-09-27 | Rebuild in 4 phases, starting with planning | Agreed by user |
| — | Open items listed in `PHASE_1_PLAN.md` §10 | Awaiting user |
