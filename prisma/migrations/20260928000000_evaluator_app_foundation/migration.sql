-- EVALUATOR_APP_PLAN.md §3: additive migration for the evaluator app
-- foundation (E1). Existing evaluations default to status = ACTIVE and
-- keep working exactly as before; the new tables have no readers yet
-- until E2-E5 build the session/claim/conflict/submission logic.

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('ACTIVE', 'DISPUTED');

-- AlterTable
ALTER TABLE "evaluations"
  ADD COLUMN IF NOT EXISTS "status" "EvaluationStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "courseId" TEXT,
  ADD COLUMN IF NOT EXISTS "rubricVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "lastSubmissionId" TEXT,
  ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lockedById" TEXT;

-- CreateTable
CREATE TABLE "evaluation_submissions" (
    "id" TEXT NOT NULL,
    "clientSubmissionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "dateISO" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "sessionId" TEXT,
    "payload" JSONB NOT NULL,
    "deviceTime" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "appVersion" TEXT,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "evaluationId" TEXT,

    CONSTRAINT "evaluation_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_submissions_clientSubmissionId_key" ON "evaluation_submissions"("clientSubmissionId");
CREATE INDEX "evaluation_submissions_studentId_dateISO_idx" ON "evaluation_submissions"("studentId", "dateISO");
CREATE INDEX "evaluation_submissions_evaluatorId_receivedAt_idx" ON "evaluation_submissions"("evaluatorId", "receivedAt");
CREATE INDEX "evaluation_submissions_outcome_idx" ON "evaluation_submissions"("outcome");

-- CreateTable
CREATE TABLE "evaluation_conflicts" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "dateISO" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "submissionIds" TEXT[],
    "chosenSubmissionId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evaluation_conflicts_status_idx" ON "evaluation_conflicts"("status");
CREATE INDEX "evaluation_conflicts_studentId_dateISO_idx" ON "evaluation_conflicts"("studentId", "dateISO");

-- CreateTable
CREATE TABLE "evaluation_claims" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "dateISO" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluation_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_claims_studentId_dateISO_key" ON "evaluation_claims"("studentId", "dateISO");

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_accountId_idx" ON "sessions"("accountId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_accountId_idx" ON "push_subscriptions"("accountId");

-- CreateTable
CREATE TABLE "reminder_logs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dateISO" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reminder_logs_accountId_kind_dateISO_stage_key" ON "reminder_logs"("accountId", "kind", "dateISO", "stage");
