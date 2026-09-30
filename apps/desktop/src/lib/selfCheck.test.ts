import { describe, expect, it } from "vitest";
import { selfCheck, worst, type Facts } from "./selfCheck";

const now = new Date("2026-10-10T09:00:00Z");
const healthy: Facts = {
  now,
  integrity: "ok",
  freeDiskBytes: 50 * 1024 ** 3,
  lastBackupAt: new Date("2026-10-10T07:00:00Z"),
  cloud: { enabled: true, lastUploadAt: new Date("2026-10-10T07:05:00Z"), error: null },
  sync: { configured: true, kind: "idle", lastAt: "2026-10-10T08:59:00Z", message: null },
  openDecisions: 0,
  update: null,
};
const level = (f: Partial<Facts>, id: string) => selfCheck({ ...healthy, ...f }).find((c) => c.id === id)?.level;

describe("self-check", () => {
  it("is all green on a healthy installation", () => {
    const checks = selfCheck(healthy);
    expect(worst(checks)).toBe("ok");
    expect(checks.map((c) => c.id)).toEqual(["database", "disk", "backup", "cloud", "sync"]);
  });

  it("flags a damaged database, low disk and old backups", () => {
    expect(level({ integrity: "row 3 missing from index" }, "database")).toBe("err");
    expect(level({ freeDiskBytes: 100 * 1024 ** 2 }, "disk")).toBe("err");
    expect(level({ freeDiskBytes: 600 * 1024 ** 2 }, "disk")).toBe("warn");
    expect(level({ lastBackupAt: null }, "backup")).toBe("err");
    expect(level({ lastBackupAt: new Date("2026-10-08T09:00:00Z") }, "backup")).toBe("warn");
    expect(level({ lastBackupAt: new Date("2026-09-20T09:00:00Z") }, "backup")).toBe("err");
  });

  it("warns when backups are only on this computer or the newest is not online", () => {
    expect(level({ cloud: { enabled: false, lastUploadAt: null, error: null } }, "cloud")).toBe("warn");
    expect(level({ cloud: { enabled: true, lastUploadAt: null, error: "مفتاح المدير غير صحيح" } }, "cloud")).toBe("err");
    expect(level({ cloud: { enabled: true, lastUploadAt: new Date("2026-10-08T07:00:00Z"), error: null } }, "cloud")).toBe("warn");
  });

  it("reports sync problems, waiting decisions and updates, each with where to fix it", () => {
    expect(level({ sync: { configured: false, kind: "off", lastAt: null, message: null } }, "sync")).toBe("warn");
    const err = selfCheck({ ...healthy, sync: { configured: true, kind: "error", lastAt: null, message: "مفتاح المدير غير صحيح" } }).find((c) => c.id === "sync")!;
    expect(err).toMatchObject({ level: "err", go: "sync" });
    expect(err.detail).toContain("مفتاح المدير غير صحيح");
    expect(level({ sync: { ...healthy.sync, lastAt: "2026-10-10T06:00:00Z" } }, "sync")).toBe("warn");
    expect(selfCheck({ ...healthy, openDecisions: 2 }).find((c) => c.id === "decisions")?.title).toContain("2");
    expect(selfCheck({ ...healthy, update: { version: "0.3.0" } }).find((c) => c.id === "update")?.go).toBe("system");
  });
});
