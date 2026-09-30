// Copies the website's database (Neon Postgres, via Prisma, read-only) into
// a new Eva Desktop database file (SQLite). Used to move the data into the
// desktop app (docs/DESKTOP_APP_PLAN.md, phase 2 test and phase 6 switch-over).
//
//   npx tsx --tsconfig tsconfig.json scripts/export-to-sqlite.ts <out.db>
//
// It never writes to the source. It refuses to overwrite an existing file,
// checks every table's row count after copying, and runs SQLite's
// integrity check before reporting success.
import { existsSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { prisma } from "../src/lib/db";
import { openBetterSqlite } from "../packages/db/src/betterSqlite";
import { migrate } from "../packages/db/src/migrate";
import { drizzleFor } from "../packages/db/src/drizzle";
import * as s from "../packages/db/src/schema";

// Source (Prisma model delegate) for each desktop table.
const SOURCES: Array<[SQLiteTable, () => Promise<Record<string, unknown>[]>]> = [
  [s.courses, () => prisma.course.findMany()],
  [s.studyTypes, () => prisma.studyType.findMany()],
  [s.hospitals, () => prisma.hospital.findMany()],
  [s.courseStudyTypes, () => prisma.courseStudyType.findMany()],
  [s.courseHospitals, () => prisma.courseHospital.findMany()],
  [s.courseAttendancePatterns, () => prisma.courseAttendancePattern.findMany()],
  [s.courseHolidays, () => prisma.courseHoliday.findMany()],
  [s.groups, () => prisma.group.findMany()],
  [s.rotationBlocks, () => prisma.rotationBlock.findMany()],
  [s.students, () => prisma.student.findMany()],
  [s.accounts, () => prisma.account.findMany()],
  [s.evaluatorAssignments, () => prisma.evaluatorAssignment.findMany()],
  [s.rubricSections, () => prisma.rubricSection.findMany()],
  [s.rubricItems, () => prisma.rubricItem.findMany()],
  [s.evaluations, () => prisma.evaluation.findMany()],
  [s.evaluationScores, () => prisma.evaluationScore.findMany()],
  [s.attendanceRecords, () => prisma.attendanceRecord.findMany()],
  [s.groupWorkDays, () => prisma.groupWorkDay.findMany()],
  [s.flags, () => prisma.flag.findMany()],
  [s.auditLog, () => prisma.auditLog.findMany()],
  [s.termSettings, () => prisma.termSettings.findMany()],
];

// Prisma row -> desktop row: keep only the desktop table's columns; dates
// become ISO text; JSON stays an object (Drizzle stores it as text).
function convert(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) {
    const v = row[c];
    if (v === undefined) continue;
    out[c] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: export-to-sqlite.ts <out.db>");
  if (existsSync(file)) throw new Error(`${file} already exists — choose a new file name`);

  const { db, exec } = openBetterSqlite(file);
  await migrate(exec);
  const d = drizzleFor(exec);
  const report: Array<[string, number]> = [];

  db.exec("BEGIN");
  try {
    for (const [table, load] of SOURCES) {
      const columns = Object.keys(getTableColumns(table));
      const rows = (await load()).map((r) => convert(r, columns));
      for (let i = 0; i < rows.length; i += 200) {
        await d.insert(table).values(rows.slice(i, i + 200) as never);
      }
      report.push([getTableName(table), rows.length]);
    }
    const stamp = new Date().toISOString();
    await d.insert(s.meta).values([
      { key: "source", value: "neon-export" },
      { key: "exportedAt", value: stamp },
    ]);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  // Verify: every table's row count matches what was read.
  let ok = true;
  for (const [name, expected] of report) {
    const got = (db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n;
    if (got !== expected) ok = false;
    console.log(`${name.padEnd(28)} ${String(expected).padStart(6)} ${got === expected ? "✓" : `✗ (file has ${got})`}`);
  }
  const integrity = (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
  const fk = db.prepare("PRAGMA foreign_key_check").all();
  console.log(`integrity_check: ${integrity} · foreign-key problems: ${fk.length}`);
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  await prisma.$disconnect();
  if (!ok || integrity !== "ok" || fk.length > 0) throw new Error("Export verification FAILED");
  console.log(`\nWrote ${file}`);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
