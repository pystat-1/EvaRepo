-- CreateTable
CREATE TABLE "term_settings" (
    "id" TEXT NOT NULL,
    "weeksCount" INTEGER,
    "daysPerWeek" INTEGER,
    "weekdays" TEXT,
    "startDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "term_settings_pkey" PRIMARY KEY ("id")
);
