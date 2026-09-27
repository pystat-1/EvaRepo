-- COURSE_SETUP_PLAN.md §8: additive migration for the Course Setup wizard.
-- Existing courses are marked PUBLISHED so they keep behaving exactly as
-- before this feature existed; existing rotation blocks and evaluator
-- assignments keep courseId = null ("legacy/global") and continue to work.

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "courses"
  ADD COLUMN IF NOT EXISTS "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS "startDate" TEXT,
  ADD COLUMN IF NOT EXISTS "weekCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "setupStep" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "scheduleVersion" INTEGER NOT NULL DEFAULT 0;

-- DataMigration: pre-existing courses were already "live" under the old
-- scattered-tabs flow, so treat them as published rather than draft.
UPDATE "courses" SET "status" = 'PUBLISHED';

-- CreateTable
CREATE TABLE "course_study_types" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "studyTypeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_study_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_study_types_courseId_studyTypeId_key" ON "course_study_types"("courseId", "studyTypeId");

-- AddForeignKey
ALTER TABLE "course_study_types" ADD CONSTRAINT "course_study_types_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_study_types" ADD CONSTRAINT "course_study_types_studyTypeId_fkey" FOREIGN KEY ("studyTypeId") REFERENCES "study_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "course_hospitals" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "capacity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_hospitals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_hospitals_courseId_hospitalId_key" ON "course_hospitals"("courseId", "hospitalId");

-- AddForeignKey
ALTER TABLE "course_hospitals" ADD CONSTRAINT "course_hospitals_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_hospitals" ADD CONSTRAINT "course_hospitals_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "course_attendance_patterns" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "shift" "Shift",
    "studyTypeId" TEXT,
    "daysOfWeek" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_attendance_patterns_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "course_attendance_patterns" ADD CONSTRAINT "course_attendance_patterns_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_attendance_patterns" ADD CONSTRAINT "course_attendance_patterns_studyTypeId_fkey" FOREIGN KEY ("studyTypeId") REFERENCES "study_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "course_holidays" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "dateISO" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_holidays_courseId_dateISO_key" ON "course_holidays"("courseId", "dateISO");

-- AddForeignKey
ALTER TABLE "course_holidays" ADD CONSTRAINT "course_holidays_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "evaluator_assignments" ADD COLUMN IF NOT EXISTS "courseId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "evaluator_assignments_courseId_idx" ON "evaluator_assignments"("courseId");

-- AddForeignKey
ALTER TABLE "evaluator_assignments" ADD CONSTRAINT "evaluator_assignments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "rotation_blocks"
  ADD COLUMN IF NOT EXISTS "courseId" TEXT,
  ADD COLUMN IF NOT EXISTS "weekIndex" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "rotation_blocks_courseId_idx" ON "rotation_blocks"("courseId");

-- AddForeignKey
ALTER TABLE "rotation_blocks" ADD CONSTRAINT "rotation_blocks_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
