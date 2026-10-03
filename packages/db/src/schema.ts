// Eva Desktop database schema (SQLite, Drizzle ORM).
//
// Mirrors the website's Prisma schema (prisma/schema.prisma) table for
// table and column for column, so data moves across unchanged:
//   - ids stay the same strings (cuid from the website; new rows use UUIDs)
//   - timestamps are ISO-8601 text ("2026-09-30T12:00:00.000Z")
//   - calendar days stay "YYYY-MM-DD" text, as on the website
//   - booleans are 0/1 integers, JSON is text
// Tables that only existed for hosting (web sessions, push subscriptions,
// reminder logs, the web-era submission journal/claims/conflicts) are not
// here; the phone sync tables arrive with the relay in phase 4.
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey();
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const createdAt = () => text("createdAt").notNull().default(now);
const updatedAt = () => text("updatedAt").notNull().default(now);
const bool = (name: string) => integer(name, { mode: "boolean" });

export type Role = "ADMIN" | "EVALUATOR" | "STUDENT";
export type Shift = "MORNING" | "EVENING";
export type CourseStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type Attendance = "present" | "late" | "absent";

export const courses = sqliteTable(
  "courses",
  {
    id: id(),
    year: integer("year").notNull(),
    number: integer("number").notNull(),
    label: text("label"),
    active: bool("active").notNull().default(true),
    status: text("status").$type<CourseStatus>().notNull().default("DRAFT"),
    startDate: text("startDate"),
    weekCount: integer("weekCount"),
    setupStep: integer("setupStep").notNull().default(1),
    scheduleVersion: integer("scheduleVersion").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("courses_year_number").on(t.year, t.number)]
);

export const studyTypes = sqliteTable("study_types", {
  id: id(),
  name: text("name").notNull().unique(),
  nameAr: text("nameAr"),
  code: text("code").unique(),
  active: bool("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const hospitals = sqliteTable("hospitals", {
  id: id(),
  name: text("name").notNull(),
  nameAr: text("nameAr"),
  address: text("address"),
  notes: text("notes"),
  active: bool("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const courseStudyTypes = sqliteTable(
  "course_study_types",
  {
    id: id(),
    courseId: text("courseId").notNull().references(() => courses.id),
    studyTypeId: text("studyTypeId").notNull().references(() => studyTypes.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("course_study_types_unique").on(t.courseId, t.studyTypeId)]
);

export const courseHospitals = sqliteTable(
  "course_hospitals",
  {
    id: id(),
    courseId: text("courseId").notNull().references(() => courses.id),
    hospitalId: text("hospitalId").notNull().references(() => hospitals.id),
    capacity: integer("capacity"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("course_hospitals_unique").on(t.courseId, t.hospitalId)]
);

export const courseAttendancePatterns = sqliteTable("course_attendance_patterns", {
  id: id(),
  courseId: text("courseId").notNull().references(() => courses.id),
  shift: text("shift").$type<Shift>(),
  studyTypeId: text("studyTypeId").references(() => studyTypes.id),
  daysOfWeek: text("daysOfWeek").notNull(),
  createdAt: createdAt(),
});

export const courseHolidays = sqliteTable(
  "course_holidays",
  {
    id: id(),
    courseId: text("courseId").notNull().references(() => courses.id),
    dateISO: text("dateISO").notNull(),
    label: text("label"),
    /** The day this holiday's schedule moved to (a make-up day), or null for a day off. */
    movedTo: text("movedTo"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("course_holidays_unique").on(t.courseId, t.dateISO)]
);

export const groups = sqliteTable(
  "groups",
  {
    id: id(),
    name: text("name").notNull(),
    cycleLabel: text("cycleLabel"),
    courseId: text("courseId").references(() => courses.id),
    shift: text("shift").$type<Shift>(),
    studyTypeId: text("studyTypeId").references(() => studyTypes.id),
    active: bool("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("groups_course").on(t.courseId)]
);

export const rotationBlocks = sqliteTable(
  "rotation_blocks",
  {
    id: id(),
    groupId: text("groupId").notNull().references(() => groups.id),
    hospitalId: text("hospitalId").notNull().references(() => hospitals.id),
    startDate: text("startDate").notNull(),
    endDate: text("endDate").notNull(),
    daysOfWeek: text("daysOfWeek"),
    notes: text("notes"),
    courseId: text("courseId").references(() => courses.id),
    weekIndex: integer("weekIndex"),
    active: bool("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("rotation_blocks_group").on(t.groupId),
    index("rotation_blocks_hospital").on(t.hospitalId),
    index("rotation_blocks_course").on(t.courseId),
  ]
);

export const students = sqliteTable(
  "students",
  {
    id: id(),
    universityNumber: text("universityNumber").notNull().unique(),
    nameAr: text("nameAr").notNull(),
    nameEn: text("nameEn"),
    email: text("email"),
    studyTypeId: text("studyTypeId").references(() => studyTypes.id),
    groupId: text("groupId").references(() => groups.id),
    courseId: text("courseId").references(() => courses.id),
    shift: text("shift").$type<Shift>(),
    code: text("code").unique(),
    active: bool("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("students_group").on(t.groupId),
    index("students_course").on(t.courseId),
    index("students_name").on(t.nameAr),
  ]
);

export const accounts = sqliteTable("accounts", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("passwordHash"),
  googleId: text("googleId").unique(),
  name: text("name").notNull(),
  role: text("role").$type<Role>().notNull().default("ADMIN"),
  studentId: text("studentId").references(() => students.id),
  active: bool("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const evaluatorAssignments = sqliteTable(
  "evaluator_assignments",
  {
    id: id(),
    accountId: text("accountId").notNull().references(() => accounts.id),
    hospitalId: text("hospitalId").notNull().references(() => hospitals.id),
    groupId: text("groupId").references(() => groups.id),
    courseId: text("courseId").references(() => courses.id),
    active: bool("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("evaluator_assignments_account").on(t.accountId)]
);

export const rubricSections = sqliteTable("rubric_sections", {
  id: id(),
  labelAr: text("labelAr").notNull(),
  labelEn: text("labelEn"),
  maxScore: real("maxScore").notNull(),
  sortOrder: integer("sortOrder").notNull().default(0),
  active: bool("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const rubricItems = sqliteTable(
  "rubric_items",
  {
    id: id(),
    sectionId: text("sectionId").notNull().references(() => rubricSections.id),
    key: text("key").notNull().unique(),
    labelAr: text("labelAr").notNull(),
    labelEn: text("labelEn"),
    maxScore: real("maxScore").notNull(),
    kind: text("kind").$type<"check" | "number">().notNull().default("number"),
    sortOrder: integer("sortOrder").notNull().default(0),
    active: bool("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rubric_items_section").on(t.sectionId)]
);

export const evaluations = sqliteTable(
  "evaluations",
  {
    id: id(),
    studentId: text("studentId").notNull().references(() => students.id),
    evaluatorId: text("evaluatorId").notNull().references(() => accounts.id),
    groupId: text("groupId"),
    hospitalId: text("hospitalId"),
    dateISO: text("dateISO").notNull(),
    attendance: text("attendance").$type<Attendance>().notNull(),
    notes: text("notes"),
    feedback: text("feedback"),
    dailyNoteSubmitted: bool("dailyNoteSubmitted").notNull().default(false),
    itemScores: text("itemScores", { mode: "json" }).$type<Record<string, number>>(),
    pendingValidation: bool("pendingValidation").notNull().default(false),
    total: real("total").notNull().default(0),
    locked: bool("locked").notNull().default(false),
    status: text("status").$type<"ACTIVE" | "DISPUTED">().notNull().default("ACTIVE"),
    courseId: text("courseId"),
    rubricVersion: integer("rubricVersion"),
    lastSubmissionId: text("lastSubmissionId"),
    lockedAt: text("lockedAt"),
    lockedById: text("lockedById"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("evaluations_student_date").on(t.studentId, t.dateISO),
    index("evaluations_group").on(t.groupId),
    index("evaluations_date").on(t.dateISO),
    index("evaluations_evaluator").on(t.evaluatorId),
  ]
);

export const evaluationScores = sqliteTable(
  "evaluation_scores",
  {
    id: id(),
    evaluationId: text("evaluationId").notNull().references(() => evaluations.id, { onDelete: "cascade" }),
    rubricSectionId: text("rubricSectionId").notNull().references(() => rubricSections.id),
    score: real("score").notNull(),
    labelArAtTime: text("labelArAtTime"),
    labelEnAtTime: text("labelEnAtTime"),
    maxScoreAtTime: real("maxScoreAtTime"),
  },
  (t) => [uniqueIndex("evaluation_scores_unique").on(t.evaluationId, t.rubricSectionId)]
);

export const attendanceRecords = sqliteTable(
  "attendance_records",
  {
    id: id(),
    studentId: text("studentId").notNull(),
    dateISO: text("dateISO").notNull(),
    groupId: text("groupId"),
    hospitalId: text("hospitalId"),
    status: text("status").$type<Attendance>().notNull(),
    markedAt: text("markedAt").notNull().default(now),
    markedById: text("markedById").notNull(),
    dailyNote: bool("dailyNote"),
    dailyNoteAt: text("dailyNoteAt"),
    dailyNoteById: text("dailyNoteById"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("attendance_records_student_date").on(t.studentId, t.dateISO),
    index("attendance_records_group_date").on(t.groupId, t.dateISO),
  ]
);

export const groupWorkDays = sqliteTable(
  "group_work_days",
  {
    id: id(),
    groupId: text("groupId").notNull(),
    dateISO: text("dateISO").notNull(),
    hospitalId: text("hospitalId"),
    scheduled: bool("scheduled").notNull().default(true),
    startedById: text("startedById").notNull(),
    startedAt: text("startedAt").notNull().default(now),
    validatedAt: text("validatedAt"),
    validatedById: text("validatedById"),
    reopenedAt: text("reopenedAt"),
    reopenedById: text("reopenedById"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("group_work_days_group_date").on(t.groupId, t.dateISO), index("group_work_days_validated").on(t.validatedAt)]
);

export const flags = sqliteTable(
  "flags",
  {
    id: id(),
    studentId: text("studentId").notNull().references(() => students.id),
    ruleId: text("ruleId").notNull(),
    severity: text("severity").notNull(),
    msg: text("msg").notNull(),
    dateISO: text("dateISO").notNull(),
    seen: bool("seen").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("flags_student_rule").on(t.studentId, t.ruleId)]
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: id(),
    actorId: text("actorId").references(() => accounts.id),
    entityType: text("entityType").notNull(),
    entityId: text("entityId").notNull(),
    action: text("action").notNull(),
    before: text("before"),
    after: text("after"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_entity").on(t.entityType, t.entityId), index("audit_log_created").on(t.createdAt)]
);

export const termSettings = sqliteTable("term_settings", {
  id: text("id").primaryKey().default("singleton"),
  weeksCount: integer("weeksCount"),
  daysPerWeek: integer("daysPerWeek"),
  weekdays: text("weekdays"),
  startDate: text("startDate"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Every validated day received from an evaluator's phone (via the relay),
// and what the desktop did with it. `clientId` makes receiving the same
// submission twice harmless. Conflicts and rejections stay here for the
// admin to review (and, for conflicts, to apply anyway).
export const syncInbox = sqliteTable(
  "sync_inbox",
  {
    clientId: text("clientId").primaryKey(),
    relaySeq: integer("relaySeq").notNull(),
    evaluatorId: text("evaluatorId").notNull(),
    groupId: text("groupId").notNull(),
    dateISO: text("dateISO").notNull(),
    payload: text("payload").notNull(), // the DaySubmission JSON as received
    receivedAt: text("receivedAt").notNull(),
    status: text("status").$type<"applied" | "conflict" | "rejected">().notNull(),
    message: text("message").notNull(),
    decidedAt: text("decidedAt").notNull(),
    reported: bool("reported").notNull().default(false), // outcome sent back to the relay
  },
  (t) => [index("sync_inbox_status").on(t.status), index("sync_inbox_seq").on(t.relaySeq)]
);

// Facts about this database file itself (schema version, when it was
// created, where its data came from). Key/value, read at start-up.
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Export order that respects foreign keys (parents before children).
export const TABLES_IN_DEPENDENCY_ORDER = [
  courses,
  studyTypes,
  hospitals,
  courseStudyTypes,
  courseHospitals,
  courseAttendancePatterns,
  courseHolidays,
  groups,
  rotationBlocks,
  students,
  accounts,
  evaluatorAssignments,
  rubricSections,
  rubricItems,
  evaluations,
  evaluationScores,
  attendanceRecords,
  groupWorkDays,
  flags,
  auditLog,
  termSettings,
] as const;
