import { describe, expect, it } from "vitest";
import { WrongKeyError, codeToKey, decryptBackup, encryptBackup, newRecoveryCode } from "./crypto";
import { planCloud } from "./plan";

describe("backup encryption", () => {
  it("round-trips through a recovery code, compressed and sealed", async () => {
    const code = await newRecoveryCode();
    expect(code).toMatch(/^([A-Z2-9]{4}-){13}[A-Z2-9]{4}$/);
    const key = (await codeToKey(code))!;
    const plain = new TextEncoder().encode("SQLite format 3\u0000" + "eva ".repeat(5000));
    const sealed = await encryptBackup(plain, key);
    expect(new TextDecoder().decode(sealed.subarray(0, 4))).toBe("EVAB");
    expect(sealed.length).toBeLessThan(plain.length / 10); // compressed first
    expect(new TextDecoder().decode(sealed)).not.toContain("SQLite"); // nothing readable
    expect(await decryptBackup(sealed, key)).toEqual(plain);
    // a code typed in lower case with spaces still works
    expect(await codeToKey(code.toLowerCase().replace(/-/g, " "))).toEqual(key);
  });

  it("rejects a mistyped code, the wrong key and a tampered file", async () => {
    const code = await newRecoveryCode();
    const typo = code.slice(0, 5) + (code[5] === "A" ? "B" : "A") + code.slice(6);
    expect(await codeToKey(typo)).toBeNull();
    const key = (await codeToKey(code))!;
    const other = (await codeToKey(await newRecoveryCode()))!;
    const sealed = await encryptBackup(new Uint8Array([1, 2, 3]), key);
    await expect(decryptBackup(sealed, other)).rejects.toBeInstanceOf(WrongKeyError);
    const tampered = sealed.slice();
    tampered[tampered.length - 1] ^= 1;
    await expect(decryptBackup(tampered, key)).rejects.toBeInstanceOf(WrongKeyError);
  });
});

describe("online backup plan", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const day = (d: number, reason = "daily") => `eva-202610${String(d).padStart(2, "0")}-080000-${reason}.db`;

  it("uploads what is missing and keeps the newest 3 locally, only once they are online", () => {
    const local = [day(5), day(6), day(7), day(8), day(9)];
    const remote = [day(5) + ".evab", day(6) + ".evab"];
    const p = planCloud(local, remote, now);
    expect(p.upload).toEqual([day(7), day(8), day(9)]);
    expect(p.deleteLocal).toEqual([day(6), day(5)]); // online already; the 3 newest stay
    expect(p.deleteRemote).toEqual([]);
  });

  it("never deletes a local backup that is not online", () => {
    const local = [day(1), day(2), day(3), day(4), day(5)];
    const p = planCloud(local, [], now);
    expect(p.upload).toHaveLength(5);
    expect(p.deleteLocal).toEqual([]); // nothing is online yet: nothing local goes
    // after only some uploads succeeded, only those may go
    expect(planCloud(local, [day(1) + ".evab"], now).deleteLocal).toEqual([day(1)]);
  });

  it("thins online copies with the usual policy", () => {
    const remote = Array.from({ length: 35 }, (_, i) => `eva-2026${String(8 + Math.floor(i / 28)).padStart(2, "0")}${String((i % 28) + 1).padStart(2, "0")}-080000-daily.db.evab`);
    const p = planCloud([], remote, now);
    expect(p.deleteRemote.length).toBeGreaterThan(0);
    expect(p.deleteRemote.length).toBeLessThanOrEqual(5);
  });
});
