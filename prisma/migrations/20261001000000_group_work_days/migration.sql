-- Additive only: work days per group (actual days worked, scheduled or
-- not) with validation, and a pending-validation flag on evaluations.
-- Existing evaluations default to pendingValidation = false, so everything
-- already saved stays visible to the admin exactly as before.

ALTER TABLE "evaluations" ADD COLUMN IF NOT EXISTS "pendingValidation" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "group_work_days" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "dateISO" TEXT NOT NULL,
    "hospitalId" TEXT,
    "scheduled" BOOLEAN NOT NULL DEFAULT true,
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "group_work_days_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "group_work_days_groupId_dateISO_key" ON "group_work_days"("groupId", "dateISO");
CREATE INDEX IF NOT EXISTS "group_work_days_validatedAt_idx" ON "group_work_days"("validatedAt");
