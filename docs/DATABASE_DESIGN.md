# Eva: Database Design (target)

> **Visual, interactive version:** https://claude.ai/artifact/CS3HFH23NKoKt58aFkJTP8 (private to the owner). Click a table there to see its columns, keys and connections.
> **Status:** target design, not migrated yet. It combines the v3 schema (`prisma/schema.prisma`) with the plans in `COURSE_SETUP_PLAN.md` (Goal 1), `EVALUATOR_APP_PLAN.md` (Goal 2) and `GRADING_CENTER_PLAN.md` (Goal 3).
> **Refinement introduced here:** the "rubric snapshot per course" from Goals 1–2 is modeled as its own table, `RubricVersion`. A published course points at one version, and each `RubricSection` belongs to a version.

## Size

28 tables, 52 relationships. 13 tables exist in v3, and 7 of those gain columns. 15 tables are new: 5 from Goal 1, 6 from Goal 2 and 4 from Goal 3.

## Areas

| Area | Tables |
|---|---|
| **Course & schedule** (the matrix) | Course, StudyType (= shift M/E), CourseStudyType, Hospital, CourseHospital, Group, Student, CourseAttendancePattern, CourseHoliday, RotationBlock |
| **People & access** | Account, Session, EvaluatorAssignment, PushSubscription, ReminderLog |
| **Evaluation engine** | **Evaluation**, EvaluationScore, EvaluationSubmission (append-only journal), EvaluationConflict, EvaluationClaim, Flag |
| **Rubric & grade policy** | RubricVersion, RubricSection, CourseGradePolicy |
| **Safety & audit** | AuditLog, CourseSnapshot, IntegrityRun, BackupRun |

## Relationships

```mermaid
erDiagram
  Course }o--o| RubricVersion : "uses rubric"
  CourseStudyType }o--|| Course : ""
  CourseStudyType }o--|| StudyType : ""
  CourseHospital }o--|| Course : ""
  CourseHospital }o--|| Hospital : ""
  Group }o--o| Course : ""
  Group }o--o| StudyType : "shift"
  Student }o--o| Course : ""
  Student }o--o| Group : ""
  Student }o--o| StudyType : "shift"
  CourseAttendancePattern }o--|| Course : ""
  CourseAttendancePattern }o--o| StudyType : ""
  CourseHoliday }o--|| Course : ""
  RotationBlock }o--|| Course : "matrix cell"
  RotationBlock }o--|| Group : ""
  RotationBlock }o--|| Hospital : ""
  EvaluatorAssignment }o--|| Account : "evaluator"
  EvaluatorAssignment }o--|| Course : ""
  EvaluatorAssignment }o--|| Hospital : ""
  EvaluatorAssignment }o--o| Group : ""
  Account }o--o| Student : "student login"
  Session }o--|| Account : ""
  PushSubscription }o--|| Account : ""
  PushSubscription }o--|| Session : ""
  ReminderLog }o--|| Account : ""
  Evaluation }o--|| Student : "one per day"
  Evaluation }o--|| Account : "owner / locked / corrected by"
  Evaluation }o--|| Course : ""
  Evaluation }o--|| Group : "snapshot"
  Evaluation }o--|| Hospital : "snapshot"
  Evaluation }o--o| RotationBlock : "placement"
  Evaluation }o--|| RubricVersion : ""
  Evaluation |o--o| EvaluationSubmission : "last submission"
  EvaluationScore }o--|| Evaluation : ""
  EvaluationScore }o--|| RubricSection : ""
  EvaluationSubmission }o--|| Student : ""
  EvaluationSubmission }o--|| Account : "evaluator"
  EvaluationSubmission }o--o| Session : ""
  EvaluationSubmission }o--o| Evaluation : "applied to"
  EvaluationConflict }o--|| Student : ""
  EvaluationConflict }o--o| EvaluationSubmission : "chosen"
  EvaluationConflict }o--o| Account : "resolved by"
  EvaluationClaim }o--|| Student : "taken"
  EvaluationClaim }o--|| Account : "taken by"
  Flag }o--|| Student : "at risk"
  RubricSection }o--|| RubricVersion : ""
  RubricVersion }o--|| Account : "created by"
  CourseGradePolicy }o--|| Course : ""
  CourseGradePolicy }o--|| Account : "created by"
  AuditLog }o--o| Account : "actor"
  CourseSnapshot }o--|| Course : ""
  CourseSnapshot }o--|| Account : "created by"
```

`IntegrityRun` and `BackupRun` stand alone (they have no foreign keys).

## Key rules enforced by the database

| Rule | How |
|---|---|
| One grade per student per day | `UNIQUE (studentId, dateISO)` on Evaluation |
| A retried save counts once | `UNIQUE clientSubmissionId` on EvaluationSubmission |
| The journal can't be rewritten | A trigger rejects UPDATE/DELETE on `evaluation_submissions` |
| The app can't delete grades | The app role has no DELETE on evaluations, scores or submissions |
| Exact numbers | `NUMERIC(5,2)` for scores, maxima and totals; `CHECK score >= 0` |
| Valid values | CHECK constraints on attendance and on every status column |
| Ordered changes | Sequence `evaluation_change_seq` → `Evaluation.changeSeq` |
| Nightly proof | IntegrityRun (totals = sum of scores, no orphans) + BackupRun (pg_dump → R2) |

**Enums:** Role (ADMIN · EVALUATOR · STUDENT) · Shift (MORNING · EVENING) · CourseStatus (DRAFT · PUBLISHED · ARCHIVED) · EvaluationStatus (ACTIVE · DISPUTED)
