import { describe, expect, it } from "vitest";
import { checkDaySubmission } from "./contract";
import { generatePassword, hashPassword, randomToken, sha256Hex, verifyPassword } from "./password";

describe("passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const pw = generatePassword();
    expect(pw).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    const stored = await hashPassword(pw);
    expect(stored.startsWith("pbkdf2$20000$")).toBe(true);
    expect(await verifyPassword(pw, stored)).toBe(true);
    expect(await verifyPassword(pw + "x", stored)).toBe(false);
    expect(await verifyPassword(pw, "garbage")).toBe(false);
  });

  it("salts: the same password hashes differently", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("makes tokens and content hashes", async () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("checkDaySubmission", () => {
  const ok = {
    clientId: "c1",
    kind: "day",
    evaluatorId: "x",
    groupId: "g1",
    dateISO: "2026-10-04",
    bundleVersion: "v1",
    validatedAt: "t",
    records: [{ studentId: "s1", attendance: "present", dailyNote: true, scores: { i1: 3.25 } }],
  };

  it("accepts a well-formed day", () => expect(checkDaySubmission(ok)).toBeNull());

  it("rejects malformed ones", () => {
    expect(checkDaySubmission({ ...ok, dateISO: "4/10/2026" })).toMatch(/تاريخ/);
    expect(checkDaySubmission({ ...ok, records: [] })).toMatch(/سجلات/);
    expect(checkDaySubmission({ ...ok, records: [{ ...ok.records[0], attendance: "sick" }] })).toMatch(/حضور/);
    expect(checkDaySubmission({ ...ok, records: [{ ...ok.records[0], scores: { i1: "3" } }] })).toMatch(/درجة/);
    expect(checkDaySubmission(null)).toMatch(/غير صالح/);
  });
});
