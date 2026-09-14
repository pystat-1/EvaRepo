# Graph Report - EvaRepo  (2026-09-15)

## Corpus Check
- Corpus is ~25,002 words - fits in a single context window. You may not need a graph.

## Summary
- 417 nodes · 970 edges · 32 communities (15 shown, 10 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Evaluator Grading Pages
- Groups & Rotation Setup
- Admin Layout & Student Accounts
- Student Import/Export
- NPM Dev Dependencies
- TypeScript Config
- NPM Runtime Dependencies
- Admin Dashboard Pages
- Evaluator Management
- Grading Center
- Project Docs & Rationale
- At-Risk Flags
- Courses & Study Types Setup
- Study Types Model
- Audit Log
- Root Layout
- ESLint Config
- Next.js Config
- Next.js Env Types
- PostCSS Config
- File Icon Asset
- Globe Icon Asset
- Next.js Logo Asset
- Vercel Logo Asset
- Window Icon Asset

## God Nodes (most connected - your core abstractions)
1. `requireRole()` - 43 edges
2. `recordAudit()` - 31 edges
3. `prisma` - 18 edges
4. `getSession()` - 17 edges
5. `compilerOptions` - 16 edges
6. `listGroups()` - 15 edges
7. `getMaxTotal()` - 15 edges
8. `listHospitals()` - 14 edges
9. `listRubricSections()` - 14 edges
10. `listStudyTypes()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Next.js Agent Rules Block` --semantically_similar_to--> `Prisma + Postgres (Neon) Database Layer`  [INFERRED] [semantically similar]
  AGENTS.md → README.md
- `main()` --calls--> `createCourse()`  [EXTRACTED]
  scripts/seed-demo.ts → src/lib/models/courses.ts
- `main()` --calls--> `createEvaluator()`  [EXTRACTED]
  scripts/seed-demo.ts → src/lib/models/evaluators.ts
- `main()` --calls--> `createGroup()`  [EXTRACTED]
  scripts/seed-demo.ts → src/lib/models/groups.ts
- `main()` --calls--> `createRotationBlock()`  [EXTRACTED]
  scripts/seed-demo.ts → src/lib/models/rotationBlocks.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Sandbox/Environment Constraints Shaping Repo Documentation** — agents_nextjs_agent_rules, readme_prisma_migration, readme_known_gaps [INFERRED 0.70]

## Communities (32 total, 10 thin omitted)

### Community 0 - "Evaluator Grading Pages"
Cohesion: 0.12
Nodes (36): RubricPage(), GradeStudentPage(), todayISO(), MyStudentsPage(), todayISO(), ATTENDANCE_LABELS, MePage(), assertEvaluatorCanGrade() (+28 more)

### Community 1 - "Groups & Rotation Setup"
Cohesion: 0.10
Nodes (35): GroupsPage(), SHIFT_LABEL, colorFor(), daysBetween(), PALETTE, SetupPage(), SHIFT_LABEL, createGroupAction() (+27 more)

### Community 2 - "Admin Layout & Student Accounts"
Cohesion: 0.10
Nodes (31): main(), AdminLayout(), NAV, StudentAccountsPage(), EvaluatorLayout(), initialState, LoginPage(), Home() (+23 more)

### Community 3 - "Student Import/Export"
Cohesion: 0.15
Nodes (26): SHIFT_LABEL, GET(), ImportStudentsForm(), initialState, createStudentAction(), ImportActionState, importStudentsAction(), parseShift() (+18 more)

### Community 4 - "NPM Dev Dependencies"
Cohesion: 0.06
Nodes (31): eslint, eslint-config-next, @netlify/plugin-nextjs, devDependencies, eslint, eslint-config-next, @netlify/plugin-nextjs, playwright (+23 more)

### Community 5 - "TypeScript Config"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 6 - "NPM Runtime Dependencies"
Cohesion: 0.07
Nodes (26): bcryptjs, jsonwebtoken, next, dependencies, bcryptjs, jsonwebtoken, next, papaparse (+18 more)

### Community 7 - "Admin Dashboard Pages"
Cohesion: 0.16
Nodes (19): main(), DashboardPage(), HospitalsPage(), StatisticsPage(), createHospitalAction(), toggleHospitalActiveAction(), updateHospitalAction(), prisma (+11 more)

### Community 8 - "Evaluator Management"
Cohesion: 0.20
Nodes (20): EvaluatorsPage(), addAssignmentAction(), createEvaluatorAction(), toggleAssignmentActiveAction(), toggleEvaluatorActiveAction(), recordAudit(), addAssignment(), AssignmentRow (+12 more)

### Community 9 - "Grading Center"
Cohesion: 0.13
Nodes (16): ATTENDANCE_BADGE, ATTENDANCE_LABEL, GradingCenterPage(), ATTENDANCE_BADGE, ATTENDANCE_LABEL, StudentGradingSummaryPage(), AutoRefresh(), Attendance (+8 more)

### Community 10 - "Project Docs & Rationale"
Cohesion: 0.14
Nodes (16): Next.js Agent Rules Block, CLAUDE.md AGENTS.md Include, Eva v3 Project, Evaluator Scoping (server-side), Flags Engine (at-risk detection), JWT_SECRET Required at Startup, Known Gaps, Phase 1: Registry (Students, Groups, Hospitals, Study Types) (+8 more)

### Community 11 - "At-Risk Flags"
Cohesion: 0.24
Nodes (12): FlagsPage(), RULE_LABELS, markFlagSeenAction(), clearFlag(), Flag, FlagWithStudent, leastSquaresSlope(), listAllFlags() (+4 more)

### Community 12 - "Courses & Study Types Setup"
Cohesion: 0.32
Nodes (10): CoursesPage(), StudentsPage(), createCourseAction(), toggleCourseActiveAction(), Course, createCourse(), getCourse(), listCourses() (+2 more)

### Community 13 - "Study Types Model"
Cohesion: 0.33
Nodes (10): StudyTypesPage(), createStudyTypeAction(), toggleStudyTypeActiveAction(), updateStudyTypeAction(), createStudyType(), getStudyType(), listStudyTypes(), serialize() (+2 more)

### Community 14 - "Audit Log"
Cohesion: 0.28
Nodes (7): ACTION_LABELS, AuditLogPage(), ENTITY_LABELS, AuditAction, AuditLogRow, EntityType, listAuditLog()

## Knowledge Gaps
- **111 isolated node(s):** `eslintConfig`, `nextConfig`, `name`, `version`, `private` (+106 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 136 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `requireRole()` connect `Student Import/Export` to `Evaluator Grading Pages`, `Groups & Rotation Setup`, `Admin Layout & Student Accounts`, `Admin Dashboard Pages`, `Evaluator Management`, `At-Risk Flags`, `Courses & Study Types Setup`, `Study Types Model`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `recordAudit()` connect `Evaluator Management` to `Evaluator Grading Pages`, `Groups & Rotation Setup`, `Admin Layout & Student Accounts`, `Student Import/Export`, `Admin Dashboard Pages`, `Courses & Study Types Setup`, `Study Types Model`, `Audit Log`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `prisma` connect `Admin Dashboard Pages` to `Evaluator Grading Pages`, `Groups & Rotation Setup`, `Admin Layout & Student Accounts`, `Student Import/Export`, `Evaluator Management`, `Grading Center`, `At-Risk Flags`, `Courses & Study Types Setup`, `Study Types Model`, `Audit Log`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **What connects `eslintConfig`, `nextConfig`, `name` to the rest of the system?**
  _111 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Evaluator Grading Pages` be split into smaller, more focused modules?**
  _Cohesion score 0.12367864693446089 - nodes in this community are weakly interconnected._
- **Should `Groups & Rotation Setup` be split into smaller, more focused modules?**
  _Cohesion score 0.10188261351052048 - nodes in this community are weakly interconnected._
- **Should `Admin Layout & Student Accounts` be split into smaller, more focused modules?**
  _Cohesion score 0.09988385598141696 - nodes in this community are weakly interconnected._