-- CreateEnum
CREATE TYPE "Shift" AS ENUM ('MORNING', 'EVENING');

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "courses_year_number_key" ON "courses"("year", "number");

-- CreateTable
CREATE TABLE "rotation_blocks" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "daysOfWeek" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rotation_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rotation_blocks_groupId_idx" ON "rotation_blocks"("groupId");

-- CreateIndex
CREATE INDEX "rotation_blocks_hospitalId_idx" ON "rotation_blocks"("hospitalId");

-- AddForeignKey
ALTER TABLE "rotation_blocks" ADD CONSTRAINT "rotation_blocks_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_blocks" ADD CONSTRAINT "rotation_blocks_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DataMigration: preserve each existing group's static hospital link as a
-- one-day placeholder rotation block (admin edits the real dates after).
INSERT INTO "rotation_blocks" ("id", "groupId", "hospitalId", "startDate", "endDate", "active", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text), "id", "hospitalId", to_char("createdAt", 'YYYY-MM-DD'), to_char("createdAt", 'YYYY-MM-DD'), true, now(), now()
FROM "groups" WHERE "hospitalId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "groups" DROP CONSTRAINT "groups_hospital_fk";

-- AlterTable
ALTER TABLE "groups" DROP COLUMN "hospitalId",
ADD COLUMN     "courseId" TEXT,
ADD COLUMN     "shift" "Shift",
ADD COLUMN     "studyTypeId" TEXT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_studyTypeId_fkey" FOREIGN KEY ("studyTypeId") REFERENCES "study_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "study_types" ADD COLUMN "code" TEXT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- DataMigration: backfill short codes for the two seeded study types.
UPDATE "study_types" SET "code" = 'N' WHERE "name" = 'Nursing' AND "code" IS NULL;
UPDATE "study_types" SET "code" = 'M' WHERE "name" = 'Medicine' AND "code" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "study_types_code_key" ON "study_types"("code");

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "code" TEXT,
ADD COLUMN     "courseId" TEXT,
ADD COLUMN     "shift" "Shift",
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "students_code_key" ON "students"("code");

-- CreateIndex
CREATE INDEX "students_courseId_idx" ON "students"("courseId");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "evaluations_hospitalId_idx" ON "evaluations"("hospitalId");
