// COURSE_SETUP_PLAN.md §6: runs the same checks live while the admin edits
// the matrix and again before publish. Pure and DB-free so the wizard UI,
// the publish guard, and tests all agree on one answer for the same
// matrix. "Attendance day falls on a holiday" (the ℹ info row in §6) is
// not checked here — it is handled upstream by attendanceDates.ts, which
// removes holidays before any date reaches this matrix.
export type ConflictSeverity = "block" | "warning" | "info";

export interface Conflict {
  severity: ConflictSeverity;
  code: string;
  message: string;
  groupId?: string;
  hospitalId?: string;
  weekIndex?: number;
}

export interface ConflictCheckerBlock {
  groupId: string;
  hospitalId: string;
  weekIndex: number;
}

export interface ConflictCheckerHospital {
  id: string;
  capacity: number | null;
}

export interface ConflictCheckerGroup {
  id: string;
  studentCount: number;
}

export interface ConflictCheckerEvaluatorAssignment {
  evaluatorId: string;
  hospitalId: string;
}

export interface CheckConflictsInput {
  weekCount: number;
  groups: ConflictCheckerGroup[];
  hospitals: ConflictCheckerHospital[];
  blocks: ConflictCheckerBlock[];
  evaluatorAssignments: ConflictCheckerEvaluatorAssignment[];
  // "each group visits each hospital once" — only meaningful when the
  // rotation was generated in that mode (§10 Q2); a hand-built matrix that
  // intentionally repeats a hospital shouldn't warn unless this is set.
  eachHospitalOnce?: boolean;
}

// A hospital with no explicit capacity is still assumed to host one group
// at a time by default — this is what makes the over-capacity check a
// warning rather than silently doing nothing when nobody typed a number.
const DEFAULT_IMPLICIT_CAPACITY = 1;

export function checkConflicts(input: CheckConflictsInput): Conflict[] {
  const conflicts: Conflict[] = [];

  const blocksByGroupWeek = new Map<string, ConflictCheckerBlock[]>();
  const blocksByHospitalWeek = new Map<string, ConflictCheckerBlock[]>();
  for (const block of input.blocks) {
    const groupWeekKey = `${block.groupId}:${block.weekIndex}`;
    blocksByGroupWeek.set(groupWeekKey, [...(blocksByGroupWeek.get(groupWeekKey) ?? []), block]);
    const hospitalWeekKey = `${block.hospitalId}:${block.weekIndex}`;
    blocksByHospitalWeek.set(hospitalWeekKey, [...(blocksByHospitalWeek.get(hospitalWeekKey) ?? []), block]);
  }

  // Group has no hospital in a week / is in two hospitals in the same week.
  for (const group of input.groups) {
    for (let weekIndex = 0; weekIndex < input.weekCount; weekIndex++) {
      const blocks = blocksByGroupWeek.get(`${group.id}:${weekIndex}`) ?? [];
      if (blocks.length === 0) {
        conflicts.push({
          severity: "warning",
          code: "group_no_hospital",
          message: `Group ${group.id} has no hospital in week ${weekIndex + 1}`,
          groupId: group.id,
          weekIndex,
        });
      } else if (new Set(blocks.map((b) => b.hospitalId)).size > 1) {
        conflicts.push({
          severity: "block",
          code: "group_two_hospitals",
          message: `Group ${group.id} is in two hospitals in week ${weekIndex + 1}`,
          groupId: group.id,
          weekIndex,
        });
      }
    }

    if (group.studentCount === 0) {
      conflicts.push({
        severity: "warning",
        code: "group_no_students",
        message: `Group ${group.id} has no students`,
        groupId: group.id,
      });
    }
  }

  // Hospital over capacity / hospital with groups but no evaluator.
  const evaluatorsByHospital = new Map<string, Set<string>>();
  for (const a of input.evaluatorAssignments) {
    evaluatorsByHospital.set(a.hospitalId, new Set([...(evaluatorsByHospital.get(a.hospitalId) ?? []), a.evaluatorId]));
  }
  for (const hospital of input.hospitals) {
    for (let weekIndex = 0; weekIndex < input.weekCount; weekIndex++) {
      const blocks = blocksByHospitalWeek.get(`${hospital.id}:${weekIndex}`) ?? [];
      const groupCount = new Set(blocks.map((b) => b.groupId)).size;
      if (groupCount === 0) continue;

      const capacity = hospital.capacity;
      const effectiveCapacity = capacity ?? DEFAULT_IMPLICIT_CAPACITY;
      if (groupCount > effectiveCapacity) {
        conflicts.push({
          severity: capacity != null ? "block" : "warning",
          code: "hospital_over_capacity",
          message: `Hospital ${hospital.id} has ${groupCount} groups in week ${weekIndex + 1}, capacity ${effectiveCapacity}`,
          hospitalId: hospital.id,
          weekIndex,
        });
      }

      if (!evaluatorsByHospital.get(hospital.id)?.size) {
        conflicts.push({
          severity: "block",
          code: "hospital_no_evaluator",
          message: `Hospital ${hospital.id} has groups in week ${weekIndex + 1} but no evaluator`,
          hospitalId: hospital.id,
          weekIndex,
        });
      }
    }
  }

  // Evaluator covers two hospitals with active groups in the same week —
  // the closest this week-granular matrix can get to "same weekday" (§6);
  // day-level overlap is checked later against the real attendance dates.
  const evaluatorHospitalsByWeek = new Map<number, Map<string, Set<string>>>();
  for (let weekIndex = 0; weekIndex < input.weekCount; weekIndex++) {
    const activeHospitalIds = new Set(
      (Array.from(blocksByHospitalWeek.entries())
        .filter(([key]) => key.endsWith(`:${weekIndex}`))
        .map(([key]) => key.split(":")[0]))
    );
    const byEvaluator = new Map<string, Set<string>>();
    for (const [hospitalId, evaluatorIds] of evaluatorsByHospital) {
      if (!activeHospitalIds.has(hospitalId)) continue;
      for (const evaluatorId of evaluatorIds) {
        byEvaluator.set(evaluatorId, new Set([...(byEvaluator.get(evaluatorId) ?? []), hospitalId]));
      }
    }
    evaluatorHospitalsByWeek.set(weekIndex, byEvaluator);
  }
  for (const [weekIndex, byEvaluator] of evaluatorHospitalsByWeek) {
    for (const [evaluatorId, hospitalIds] of byEvaluator) {
      if (hospitalIds.size > 1) {
        conflicts.push({
          severity: "warning",
          code: "evaluator_two_hospitals",
          message: `Evaluator ${evaluatorId} covers ${hospitalIds.size} hospitals in week ${weekIndex + 1}`,
          weekIndex,
        });
      }
    }
  }

  // Group revisits a hospital it already covered, when the rotation is
  // meant to place each group at each hospital exactly once.
  if (input.eachHospitalOnce) {
    const visitedByGroup = new Map<string, Map<string, number>>();
    for (const block of input.blocks) {
      const counts = visitedByGroup.get(block.groupId) ?? new Map<string, number>();
      counts.set(block.hospitalId, (counts.get(block.hospitalId) ?? 0) + 1);
      visitedByGroup.set(block.groupId, counts);
    }
    for (const [groupId, counts] of visitedByGroup) {
      for (const [hospitalId, weeksAtHospital] of counts) {
        // More than one distinct week at the same hospital counts as one
        // "stint", not a repeat visit — only a gap-and-return is a repeat.
        const weeksForPair = input.blocks
          .filter((b) => b.groupId === groupId && b.hospitalId === hospitalId)
          .map((b) => b.weekIndex)
          .sort((a, b) => a - b);
        const isContiguous = weeksForPair.every((w, i) => i === 0 || w === weeksForPair[i - 1] + 1);
        if (!isContiguous && weeksAtHospital > 0) {
          conflicts.push({
            severity: "warning",
            code: "group_repeats_hospital",
            message: `Group ${groupId} visits hospital ${hospitalId} more than once`,
            groupId,
            hospitalId,
          });
        }
      }
    }
  }

  return conflicts;
}
