-- The score snapshot columns were added to the Prisma schema but never
-- migrated into this database, so any query selecting them (e.g. the grading
-- center table view, student detail, exports) failed with P2022. Add them.
ALTER TABLE "evaluation_scores" ADD COLUMN IF NOT EXISTS "labelArAtTime" TEXT;
ALTER TABLE "evaluation_scores" ADD COLUMN IF NOT EXISTS "labelEnAtTime" TEXT;
ALTER TABLE "evaluation_scores" ADD COLUMN IF NOT EXISTS "maxScoreAtTime" DOUBLE PRECISION;
