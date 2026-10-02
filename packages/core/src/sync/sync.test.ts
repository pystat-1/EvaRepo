import { describe, expect, it } from "vitest";
import { checkDaySubmission } from "./contract";
import { randomToken, sha256Hex } from "./tokens";

describe("tokens", () => {
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
