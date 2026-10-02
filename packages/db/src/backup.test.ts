import { describe, expect, it } from "vitest";
import { backupFileName, backupsToDelete, isDailyBackupDue, parseBackupName, shouldBackupBeforeMigrating } from "./backup";

describe("backup names", () => {
  it("round-trips a name", () => {
    const when = new Date(Date.UTC(2026, 8, 30, 14, 5, 9));
    const name = backupFileName(when, "before-migrate");
    expect(name).toBe("eva-20260930-140509-before-migrate.db");
    expect(parseBackupName(name)).toEqual({ name, takenAt: when, reason: "before-migrate" });
  });

  it("ignores files that aren't backups", () => {
    expect(parseBackupName("eva.db")).toBeNull();
    expect(parseBackupName("eva-2026-09-30.db")).toBeNull();
  });
});

describe("when to back up", () => {
  const now = new Date(Date.UTC(2026, 8, 30, 12));
  it("is due with no backups, or when the newest is a day old", () => {
    expect(isDailyBackupDue([], now)).toBe(true);
    expect(isDailyBackupDue(["eva-20260929-110000-daily.db"], now)).toBe(true);
    expect(isDailyBackupDue(["eva-20260929-130000-daily.db"], now)).toBe(false);
  });

  it("backs up before migrating only a file that already has a schema", () => {
    expect(shouldBackupBeforeMigrating(1, 0)).toBe(false); // brand-new file
    expect(shouldBackupBeforeMigrating(1, 3)).toBe(true);
    expect(shouldBackupBeforeMigrating(0, 3)).toBe(false);
  });
});

describe("retention", () => {
  const now = new Date(Date.UTC(2026, 8, 30, 12));
  const daily = (daysAgo: number) => backupFileName(new Date(now.getTime() - daysAgo * 86400000), "daily");

  it("keeps everything when there are 30 or fewer", () => {
    const files = Array.from({ length: 30 }, (_, i) => daily(i));
    expect(backupsToDelete(files, now)).toEqual([]);
  });

  it("keeps the newest 30 plus the oldest of each recent month", () => {
    const files = Array.from({ length: 120 }, (_, i) => daily(i)); // four months of dailies
    const del = new Set(backupsToDelete(files, now));
    const kept = files.filter((f) => !del.has(f));
    for (let i = 0; i < 30; i++) expect(kept).toContain(daily(i));
    // one extra per older month: June, July, August (their first backup)
    expect(kept.length).toBe(30 + 3);
    expect(kept).toContain(files[119]); // the oldest overall (June)
  });

  it("never deletes files it doesn't recognise", () => {
    const files = [...Array.from({ length: 40 }, (_, i) => daily(i)), "eva.db", "notes.txt"];
    const del = backupsToDelete(files, now);
    expect(del).not.toContain("eva.db");
    expect(del).not.toContain("notes.txt");
  });
});
