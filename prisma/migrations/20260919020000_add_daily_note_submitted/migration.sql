-- Track whether the student submitted their daily clinical note that day.
ALTER TABLE "evaluations" ADD COLUMN IF NOT EXISTS "dailyNoteSubmitted" BOOLEAN NOT NULL DEFAULT false;
