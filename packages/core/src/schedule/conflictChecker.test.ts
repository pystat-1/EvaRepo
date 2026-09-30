import { describe, expect, it } from "vitest";
import { checkConflicts } from "./conflictChecker";

const baseGroups = [{ id: "g1", studentCount: 5 }];
const baseHospitals = [{ id: "h1", capacity: 2 }];
const baseEvaluators = [{ evaluatorId: "e1", hospitalId: "h1" }];

describe("checkConflicts", () => {
  it("flags a group with no hospital in a week as a warning", () => {
    const conflicts = checkConflicts({
      weekCount: 1,
      groups: baseGroups,
      hospitals: baseHospitals,
      blocks: [],
      evaluatorAssignments: baseEvaluators,
    });
    expect(conflicts).toContainEqual(
      expect.objectContaining({ code: "group_no_hospital", severity: "warning", groupId: "g1", weekIndex: 0 })
    );
  });

  it("blocks a group assigned to two hospitals in the same week", () => {
    const conflicts = checkConflicts({
      weekCount: 1,
      groups: baseGroups,
      hospitals: [
        { id: "h1", capacity: 2 },
        { id: "h2", capacity: 2 },
      ],
      blocks: [
        { groupId: "g1", hospitalId: "h1", weekIndex: 0 },
        { groupId: "g1", hospitalId: "h2", weekIndex: 0 },
      ],
      evaluatorAssignments: [
        { evaluatorId: "e1", hospitalId: "h1" },
        { evaluatorId: "e2", hospitalId: "h2" },
      ],
    });
    expect(conflicts).toContainEqual(expect.objectContaining({ code: "group_two_hospitals", severity: "block" }));
  });

  it("blocks over-capacity when a capacity is set", () => {
    const conflicts = checkConflicts({
      weekCount: 1,
      groups: [
        { id: "g1", studentCount: 5 },
        { id: "g2", studentCount: 5 },
        { id: "g3", studentCount: 5 },
      ],
      hospitals: baseHospitals, // capacity 2
      blocks: [
        { groupId: "g1", hospitalId: "h1", weekIndex: 0 },
        { groupId: "g2", hospitalId: "h1", weekIndex: 0 },
        { groupId: "g3", hospitalId: "h1", weekIndex: 0 },
      ],
      evaluatorAssignments: baseEvaluators,
    });
    expect(conflicts).toContainEqual(expect.objectContaining({ code: "hospital_over_capacity", severity: "block" }));
  });

  it("warns instead of blocking when no capacity was set", () => {
    const conflicts = checkConflicts({
      weekCount: 1,
      groups: [
        { id: "g1", studentCount: 5 },
        { id: "g2", studentCount: 5 },
      ],
      hospitals: [{ id: "h1", capacity: null }],
      blocks: [
        { groupId: "g1", hospitalId: "h1", weekIndex: 0 },
        { groupId: "g2", hospitalId: "h1", weekIndex: 0 },
      ],
      evaluatorAssignments: baseEvaluators,
    });
    expect(conflicts).toContainEqual(expect.objectContaining({ code: "hospital_over_capacity", severity: "warning" }));
  });

  it("blocks a hospital with groups but no evaluator", () => {
    const conflicts = checkConflicts({
      weekCount: 1,
      groups: baseGroups,
      hospitals: baseHospitals,
      blocks: [{ groupId: "g1", hospitalId: "h1", weekIndex: 0 }],
      evaluatorAssignments: [],
    });
    expect(conflicts).toContainEqual(expect.objectContaining({ code: "hospital_no_evaluator", severity: "block" }));
  });

  it("warns when a group has no students", () => {
    const conflicts = checkConflicts({
      weekCount: 1,
      groups: [{ id: "g1", studentCount: 0 }],
      hospitals: baseHospitals,
      blocks: [{ groupId: "g1", hospitalId: "h1", weekIndex: 0 }],
      evaluatorAssignments: baseEvaluators,
    });
    expect(conflicts).toContainEqual(expect.objectContaining({ code: "group_no_students", severity: "warning" }));
  });

  it("warns when an evaluator covers two hospitals active the same week", () => {
    const conflicts = checkConflicts({
      weekCount: 1,
      groups: [
        { id: "g1", studentCount: 5 },
        { id: "g2", studentCount: 5 },
      ],
      hospitals: [
        { id: "h1", capacity: 2 },
        { id: "h2", capacity: 2 },
      ],
      blocks: [
        { groupId: "g1", hospitalId: "h1", weekIndex: 0 },
        { groupId: "g2", hospitalId: "h2", weekIndex: 0 },
      ],
      evaluatorAssignments: [
        { evaluatorId: "e1", hospitalId: "h1" },
        { evaluatorId: "e1", hospitalId: "h2" },
      ],
    });
    expect(conflicts).toContainEqual(expect.objectContaining({ code: "evaluator_two_hospitals", severity: "warning" }));
  });

  it("warns when a group revisits a hospital under eachHospitalOnce mode", () => {
    const conflicts = checkConflicts({
      weekCount: 3,
      groups: baseGroups,
      hospitals: baseHospitals,
      blocks: [
        { groupId: "g1", hospitalId: "h1", weekIndex: 0 },
        { groupId: "g1", hospitalId: "h1", weekIndex: 2 },
      ],
      evaluatorAssignments: baseEvaluators,
      eachHospitalOnce: true,
    });
    expect(conflicts).toContainEqual(expect.objectContaining({ code: "group_repeats_hospital", severity: "warning" }));
  });

  it("does not warn about a contiguous multi-week stint at one hospital", () => {
    const conflicts = checkConflicts({
      weekCount: 2,
      groups: baseGroups,
      hospitals: baseHospitals,
      blocks: [
        { groupId: "g1", hospitalId: "h1", weekIndex: 0 },
        { groupId: "g1", hospitalId: "h1", weekIndex: 1 },
      ],
      evaluatorAssignments: baseEvaluators,
      eachHospitalOnce: true,
    });
    expect(conflicts.some((c) => c.code === "group_repeats_hospital")).toBe(false);
  });
});
