import { prisma } from "../db";
import { recordAudit } from "../audit";

// The setup wizard's term configuration is a single global row. We pin its
// primary key so there is exactly one — reads upsert-read it, writes upsert
// it, so callers never have to worry about whether it exists yet.
const SINGLETON_ID = "singleton";

export interface TermSettings {
  weeksCount: number | null;
  daysPerWeek: number | null;
  weekdays: string | null; // comma-separated codes, e.g. "SUN,TUE"
  startDate: string | null;
  updatedAt: string | null;
}

const EMPTY: TermSettings = {
  weeksCount: null,
  daysPerWeek: null,
  weekdays: null,
  startDate: null,
  updatedAt: null,
};

function serialize(row: {
  weeksCount: number | null;
  daysPerWeek: number | null;
  weekdays: string | null;
  startDate: string | null;
  updatedAt: Date;
}): TermSettings {
  return {
    weeksCount: row.weeksCount,
    daysPerWeek: row.daysPerWeek,
    weekdays: row.weekdays,
    startDate: row.startDate,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getTermSettings(): Promise<TermSettings> {
  try {
    const row = await prisma.termSettings.findUnique({ where: { id: SINGLETON_ID } });
    return row ? serialize(row) : EMPTY;
  } catch (err) {
    // Before the term_settings migration is applied the table doesn't exist
    // (Postgres 42P01 / Prisma P2021). Treat that as "not configured yet" so
    // the setup wizard and master workbook still render instead of 500-ing;
    // any other error is a real fault and is rethrown.
    const code = (err as { code?: string })?.code;
    if (code === "P2021" || code === "42P01") return EMPTY;
    throw err;
  }
}

export interface TermSettingsInput {
  weeksCount?: number | null;
  daysPerWeek?: number | null;
  weekdays?: string | null;
  startDate?: string | null;
}

export async function updateTermSettings(
  actorId: string,
  data: TermSettingsInput
): Promise<TermSettings> {
  const beforeRow = await prisma.termSettings.findUnique({ where: { id: SINGLETON_ID } });
  const before = beforeRow ? serialize(beforeRow) : EMPTY;

  // Only overwrite fields the caller actually supplied — each wizard step
  // saves its own slice of the term config, so a partial update from the
  // "weeks" step must not blank out the "days per week" step's values.
  const merged = {
    weeksCount: data.weeksCount === undefined ? before.weeksCount : data.weeksCount,
    daysPerWeek: data.daysPerWeek === undefined ? before.daysPerWeek : data.daysPerWeek,
    weekdays: data.weekdays === undefined ? before.weekdays : data.weekdays,
    startDate: data.startDate === undefined ? before.startDate : data.startDate,
  };

  const row = await prisma.termSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...merged },
    update: merged,
  });
  const after = serialize(row);
  await recordAudit({
    actorId,
    entityType: "TermSettings",
    entityId: SINGLETON_ID,
    action: beforeRow ? "update" : "create",
    before,
    after,
  });
  return after;
}
