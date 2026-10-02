import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openBetterSqlite } from "./betterSqlite";
import { appliedMigrations, migrate, pendingMigrations } from "./migrate";
import { MIGRATIONS } from "./migrations";
import { drizzleFor } from "./drizzle";
import * as schema from "./schema";

const fresh = () => openBetterSqlite(":memory:");

// Drizzle wraps the SQLite error; the constraint name is in its cause.
async function expectDbError(p: Promise<unknown>, pattern: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e as Error & { cause?: Error }
  );
  expect(err, "expected the database to refuse this").not.toBeNull();
  expect(`${err!.message} ${err!.cause?.message ?? ""}`).toMatch(pattern);
}

describe("migrations", () => {
  it("creates every table on a new file and records the version", async () => {
    const { db, exec } = fresh();
    const applied = await migrate(exec);
    expect(applied).toEqual(MIGRATIONS.map((m) => m.name));
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of ["students", "groups", "evaluations", "evaluation_scores", "rotation_blocks", "group_work_days", "_migrations"]) {
      expect(tables).toContain(t);
    }
  });

  it("is a no-op the second time", async () => {
    const { exec } = fresh();
    await migrate(exec);
    expect(await migrate(exec)).toEqual([]);
    expect(await pendingMigrations(exec)).toEqual([]);
  });

  it("rolls back a failing migration completely", async () => {
    const { db, exec } = fresh();
    await migrate(exec);
    const bad = [...MIGRATIONS, { name: "9999_bad", sql: 'CREATE TABLE "half_done" (x int);\nTHIS IS NOT SQL;' }];
    await expect(migrate(exec, bad)).rejects.toThrow(/9999_bad/);
    expect(await appliedMigrations(exec)).not.toContain("9999_bad");
    const half = db.prepare("SELECT name FROM sqlite_master WHERE name='half_done'").get();
    expect(half).toBeUndefined();
  });

  it("refuses a file written by a newer app version", async () => {
    const { exec } = fresh();
    await migrate(exec);
    await exec.run(`INSERT INTO "_migrations" ("name","appliedAt") VALUES ('9000_future','x')`);
    await expect(pendingMigrations(exec)).rejects.toThrow(/حدّث التطبيق/);
  });
});

describe("schema behaviour", () => {
  async function seeded() {
    const f = fresh();
    await migrate(f.exec);
    const d = drizzleFor(f.exec);
    await d.insert(schema.courses).values({ id: "c1", year: 2026, number: 1, label: "دورة", status: "PUBLISHED" });
    await d.insert(schema.groups).values({ id: "g1", name: "المجموعة الصباحية 1", courseId: "c1", shift: "MORNING" });
    await d.insert(schema.students).values({ id: "s1", universityNumber: "4410001", nameAr: "زينب", groupId: "g1", courseId: "c1", shift: "MORNING" });
    return { ...f, d };
  }

  it("reads back typed values through Drizzle", async () => {
    const { d } = await seeded();
    const [s] = await d.select().from(schema.students).where(eq(schema.students.universityNumber, "4410001"));
    expect(s.nameAr).toBe("زينب");
    expect(s.active).toBe(true); // boolean default
    expect(s.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("enforces foreign keys", async () => {
    const { d } = await seeded();
    await expectDbError(
      d.insert(schema.students).values({ id: "s2", universityNumber: "x", nameAr: "y", groupId: "no-such-group" }),
      /FOREIGN KEY/
    );
  });

  it("enforces one evaluation per student per day", async () => {
    const { d } = await seeded();
    await d.insert(schema.accounts).values({ id: "e1", email: "e@x", name: "E", role: "EVALUATOR" });
    const row = { studentId: "s1", evaluatorId: "e1", dateISO: "2026-10-04", attendance: "present" as const };
    await d.insert(schema.evaluations).values({ id: "v1", ...row });
    await expectDbError(d.insert(schema.evaluations).values({ id: "v2", ...row }), /UNIQUE/);
  });

  it("stores item scores as JSON", async () => {
    const { d } = await seeded();
    await d.insert(schema.accounts).values({ id: "e1", email: "e@x", name: "E", role: "EVALUATOR" });
    await d.insert(schema.evaluations).values({
      id: "v1", studentId: "s1", evaluatorId: "e1", dateISO: "2026-10-04", attendance: "present", itemScores: { gdisc: 3.25 },
    });
    const [v] = await d.select().from(schema.evaluations);
    expect(v.itemScores).toEqual({ gdisc: 3.25 });
  });
});
