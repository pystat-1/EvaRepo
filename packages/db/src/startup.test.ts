import { describe, expect, it } from "vitest";
import { openBetterSqlite } from "./betterSqlite";
import { startup, type BackupApi } from "./startup";
import { MIGRATIONS } from "./migrations";
import { backupFileName } from "./backup";

function fakeBackups(initial: string[] = [], integrity = "ok") {
  const files = new Set(initial);
  const api: BackupApi = {
    integrity: async () => integrity,
    create: async (name) => void files.add(name),
    list: async () => [...files],
    remove: async (names) => names.forEach((n) => files.delete(n)),
  };
  return { api, files };
}

const now = new Date(Date.UTC(2026, 9, 1, 8, 0, 0));

describe("startup", () => {
  it("new file: migrates without a pre-migration backup, then takes the first daily backup", async () => {
    const { exec } = openBetterSqlite(":memory:");
    const { api, files } = fakeBackups();
    const r = await startup(exec, api, now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migrated).toEqual(MIGRATIONS.map((m) => m.name));
    expect(r.backupsTaken).toEqual([backupFileName(now, "daily")]);
    expect([...files]).toEqual([backupFileName(now, "daily")]);
  });

  it("existing file with a pending upgrade: backs up BEFORE migrating", async () => {
    const { exec } = openBetterSqlite(":memory:");
    const { api } = fakeBackups();
    await startup(exec, api, now);
    const next = [...MIGRATIONS, { name: "0001_add_note", sql: 'ALTER TABLE "students" ADD COLUMN "note" text;' }];
    const later = new Date(now.getTime() + 3600_000);
    const r = await startup(exec, api, later, next);
    expect(r.ok && r.migrated).toEqual(["0001_add_note"]);
    expect(r.ok && r.backupsTaken).toEqual([backupFileName(later, "before-migrate")]);
  });

  it("nothing to do: no backup within 24 h, nothing migrated", async () => {
    const { exec } = openBetterSqlite(":memory:");
    const { api } = fakeBackups();
    await startup(exec, api, now);
    const r = await startup(exec, api, new Date(now.getTime() + 2 * 3600_000));
    expect(r).toMatchObject({ ok: true, migrated: [], backupsTaken: [], backupsDeleted: 0 });
  });

  it("damaged file: stops before touching it", async () => {
    const { exec, db } = openBetterSqlite(":memory:");
    const { api, files } = fakeBackups([], "*** in database main *** Page 5: btree corrupt");
    const r = await startup(exec, api, now);
    expect(r).toEqual({ ok: false, reason: "damaged", detail: "*** in database main *** Page 5: btree corrupt" });
    expect(files.size).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='students'").get()).toBeUndefined();
  });

  it("failed upgrade: reports it, keeps the pre-upgrade backup, leaves the old schema", async () => {
    const { exec } = openBetterSqlite(":memory:");
    const { api, files } = fakeBackups();
    await startup(exec, api, now);
    const bad = [...MIGRATIONS, { name: "0001_broken", sql: "NOT SQL AT ALL;" }];
    const later = new Date(now.getTime() + 3600_000);
    const r = await startup(exec, api, later, bad);
    expect(r).toMatchObject({ ok: false, reason: "migration-failed", backupsTaken: [backupFileName(later, "before-migrate")] });
    expect(files.has(backupFileName(later, "before-migrate"))).toBe(true);
  });

  it("prunes old backups by the retention policy", async () => {
    const { exec } = openBetterSqlite(":memory:");
    const old = Array.from({ length: 45 }, (_, i) => backupFileName(new Date(now.getTime() - (i + 1) * 86400_000), "daily"));
    const { api, files } = fakeBackups(old);
    const r = await startup(exec, api, now);
    expect(r.ok && r.backupsDeleted).toBeGreaterThan(0);
    expect(files.size).toBeLessThan(46);
    expect(files.has(backupFileName(now, "daily"))).toBe(true);
  });
});
