-- CreateIndex
CREATE INDEX "accounts_studentId_idx" ON "accounts"("studentId");

-- CreateIndex
CREATE INDEX "evaluations_evaluatorId_idx" ON "evaluations"("evaluatorId");

-- CreateIndex
CREATE INDEX "evaluations_dateISO_idx" ON "evaluations"("dateISO");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");
