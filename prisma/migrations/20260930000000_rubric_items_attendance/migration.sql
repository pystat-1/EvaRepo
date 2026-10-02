-- Additive only: rubric items (فقرات), per-item scores on evaluations, and
-- per-day attendance/daily-note records. No existing data is modified.

CREATE TABLE IF NOT EXISTS "rubric_items" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "labelEn" TEXT,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'number',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rubric_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "rubric_items_key_key" ON "rubric_items"("key");
CREATE INDEX IF NOT EXISTS "rubric_items_sectionId_idx" ON "rubric_items"("sectionId");
ALTER TABLE "rubric_items" ADD CONSTRAINT "rubric_items_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "rubric_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "evaluations" ADD COLUMN IF NOT EXISTS "itemScores" JSONB;

CREATE TABLE IF NOT EXISTS "attendance_records" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "dateISO" TEXT NOT NULL,
    "groupId" TEXT,
    "hospitalId" TEXT,
    "status" TEXT NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "markedById" TEXT NOT NULL,
    "dailyNote" BOOLEAN,
    "dailyNoteAt" TIMESTAMP(3),
    "dailyNoteById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_records_studentId_dateISO_key" ON "attendance_records"("studentId", "dateISO");
CREATE INDEX IF NOT EXISTS "attendance_records_groupId_dateISO_idx" ON "attendance_records"("groupId", "dateISO");
