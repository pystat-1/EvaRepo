import { describe, expect, it } from "vitest";
import { generateRotation } from "./rotationGenerator";

describe("generateRotation", () => {
  it("gives every group a hospital in every week", () => {
    const groups = [{ id: "g1" }, { id: "g2" }, { id: "g3" }];
    const hospitals = [
      { id: "h1", capacity: null },
      { id: "h2", capacity: null },
      { id: "h3", capacity: null },
    ];
    const drafts = generateRotation({ groups, hospitals, weekCount: 3, stintWeeks: 1 });

    for (const group of groups) {
      for (let week = 0; week < 3; week++) {
        const matches = drafts.filter((d) => d.groupId === group.id && d.weekIndex === week);
        expect(matches).toHaveLength(1);
      }
    }
  });

  it("rotates each group through a different hospital each stint (Latin square)", () => {
    const groups = [{ id: "g1" }, { id: "g2" }, { id: "g3" }];
    const hospitals = [
      { id: "h1", capacity: null },
      { id: "h2", capacity: null },
      { id: "h3", capacity: null },
    ];
    const drafts = generateRotation({ groups, hospitals, weekCount: 3, stintWeeks: 1 });

    for (const group of groups) {
      const hospitalIds = drafts.filter((d) => d.groupId === group.id).map((d) => d.hospitalId);
      expect(new Set(hospitalIds).size).toBe(3); // visited all 3, no repeats
    }
  });

  it("never exceeds a hospital's capacity within a single week", () => {
    const groups = [{ id: "g1" }, { id: "g2" }, { id: "g3" }, { id: "g4" }];
    const hospitals = [
      { id: "h1", capacity: 1 },
      { id: "h2", capacity: 2 },
    ];
    const drafts = generateRotation({ groups, hospitals, weekCount: 2, stintWeeks: 1 });

    for (let week = 0; week < 2; week++) {
      for (const hospital of hospitals) {
        const count = drafts.filter((d) => d.weekIndex === week && d.hospitalId === hospital.id).length;
        expect(count).toBeLessThanOrEqual(hospital.capacity!);
      }
    }
  });

  it("keeps a group at the same hospital for the full stint length", () => {
    const groups = [{ id: "g1" }];
    const hospitals = [{ id: "h1", capacity: null }, { id: "h2", capacity: null }];
    const drafts = generateRotation({ groups, hospitals, weekCount: 4, stintWeeks: 2 });

    const weeksAtH1 = drafts.filter((d) => d.hospitalId === "h1").map((d) => d.weekIndex).sort();
    expect(weeksAtH1).toEqual([0, 1]);
  });

  it("returns an empty array with no groups or no hospitals", () => {
    expect(generateRotation({ groups: [], hospitals: [{ id: "h1", capacity: null }], weekCount: 2 })).toEqual([]);
    expect(generateRotation({ groups: [{ id: "g1" }], hospitals: [], weekCount: 2 })).toEqual([]);
  });

  it("rejects a non-positive weekCount", () => {
    expect(() =>
      generateRotation({ groups: [{ id: "g1" }], hospitals: [{ id: "h1", capacity: null }], weekCount: 0 })
    ).toThrow();
  });
});
