# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Nursing/medical college staff and students, in Arabic (RTL). Three roles:
- **Admins**: manage hospitals, evaluators, groups, rotation blocks, courses, students, study types, rubrics; run bulk CSV imports; review audit logs and statistics; use the Grading Center to oversee grading across the program.
- **Evaluators**: hospital-based faculty/preceptors who grade students' daily hospital practice against a rubric, on a schedule tied to rotation blocks and groups. Often used at the point of care, sometimes offline.
- **Students**: view their own grades, schedule, and evaluation history ("me" area).

## Product Purpose

Digitizes the daily clinical-practice evaluation workflow for a nursing college: replaces paper/ad-hoc grading with a structured system for scheduling evaluators against hospital rotations, capturing rubric-based grades per student per day, and giving admins visibility (Grading Center, statistics, audit log) into program-wide evaluation completeness and quality. Success = every scheduled evaluation gets recorded accurately, nothing is lost, and admins can see gaps/status at a glance.

## Positioning

Purpose-built for the hospital-rotation evaluation workflow specifically (groups × rotation blocks × hospitals × evaluators × rubrics), including offline-capable grading for evaluators working in hospitals with unreliable connectivity, and CSV bulk import to onboard a whole cohort's hospitals/evaluators/groups/rotation blocks at once — not a generic gradebook or LMS.

## Operating Context

- RTL Arabic UI throughout (`dir="rtl"`, `lang="ar"`).
- Deployed on Cloudflare Workers (via OpenNext), Neon Postgres via Prisma.
- Evaluators may grade offline (PWA/service worker, IndexedDB outbox, sync-when-online) since hospital wifi is unreliable.
- Bulk CSV import exists for hospitals, evaluators, groups, and rotation blocks (onboarding a cohort at once).
- Google Sign-In is used for auth on at least one flow.
- Real production system with real student/evaluation data currently in use.

## Capabilities and Constraints

- **Zero data loss is non-negotiable** — this is treated as a hard constraint by the team (see PROJECT_GOALS.md Goal 2). Any redesign must not touch data-handling logic, only presentation.
- Role-gated route groups: `(admin)`, `(evaluator)`, `(student)`, matching the three user roles above.
- Admin surfaces include: dashboard, Grading Center (tree view, recently redesigned against real data), courses, evaluators, flags, groups, hospitals, master data, rubric, setup, statistics, student accounts, students, study types, audit log.
- Evaluator surfaces: schedule, grade (per-student grading), "my" (own activity).
- Student surface: "me" (own grades/schedule).
- Tech stack: Next.js 16 (App Router), React 19, Tailwind CSS v4, no existing component library (no shadcn) — components are hand-rolled (`GradingTree`, `ImportCsvForm`, `Pager`, etc.).
- This redesign task is presentation-only: visual design system, layout, typography, color, component styling. Data flows, routes, and business logic are out of scope and must be preserved exactly.

## Brand Commitments

No existing formal brand identity beyond the name "Eva" and a teal-blue theme color (`#1a5276`) currently set as the PWA theme color. No logo, no locked palette beyond that hint. Free to establish a real visual identity.

## Evidence on Hand

- Live implementation in `src/app` and `src/components` is the incumbent visual system (functional but not documented as a deliberate design system) — treated as anti-reference for this redesign, not as constraint.
- `PROJECT_GOALS.md` is the team's running engineering log; not a source of visual direction.
- No user research, testimonials, or brand assets on file beyond the above.

## Product Principles

1. Daily-use operational tool first — clarity, scanability, and speed for repeated task completion outrank decorative flourish (Operate mode, not Persuade).
2. Trust and precision matter more than personality — this handles real student evaluation records; the design should read as institutionally credible and calm, never gimmicky.
3. RTL Arabic is the primary language experience, not an afterthought — typography, iconography, and layout direction must be designed for RTL first.
4. Role clarity — admin, evaluator, and student contexts should feel like the same system but be visually legible about which mode you're in (e.g. via consistent-but-distinguishable navigation/chrome).
5. Never regress functionality or data integrity while restyling.

## Accessibility & Inclusion

No formal standard specified. Given clinical/educational use across varied devices (including hospital settings, possibly older hardware/spotty connectivity), the design should default to strong contrast, readable Arabic type sizes, and graceful behavior under slow/offline network conditions.
