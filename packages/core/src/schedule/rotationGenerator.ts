// COURSE_SETUP_PLAN.md §4 step 8: auto-generates a fair round-robin
// rotation — each group visits each hospital once, respecting capacity —
// that the admin then adjusts by hand in the matrix. Pure and DB-free: it
// takes plain group/hospital lists and returns draft blocks, one row per
// group-week (matching how RotationBlock.weekIndex is stored — see
// prisma/schema.prisma's RotationBlock doc comment), for the caller to
// either preview or persist via prisma.$transaction.
export interface RotationInputGroup {
  id: string;
}

export interface RotationInputHospital {
  id: string;
  capacity: number | null; // null = unlimited
}

export interface RotationDraftBlock {
  groupId: string;
  hospitalId: string;
  weekIndex: number; // 0-based
}

export interface GenerateRotationInput {
  groups: RotationInputGroup[];
  hospitals: RotationInputHospital[];
  weekCount: number;
  // How many consecutive weeks a group stays at one hospital before moving
  // on (COURSE_SETUP_PLAN.md §10 Q2: "stint length is set in step 8; the
  // default is 1 week").
  stintWeeks?: number;
}

// Unassigned weeks (no hospital had room) surface as a `null` hospitalId
// in the returned drafts filtered out by the caller — the conflict
// checker turns those gaps into "group has no hospital this week" warnings.
export function generateRotation(input: GenerateRotationInput): RotationDraftBlock[] {
  const { groups, hospitals, weekCount } = input;
  const stintWeeks = input.stintWeeks && input.stintWeeks > 0 ? input.stintWeeks : 1;
  if (!Number.isInteger(weekCount) || weekCount < 1) {
    throw new Error("weekCount must be a positive integer");
  }
  if (groups.length === 0 || hospitals.length === 0) return [];

  const stintCount = Math.ceil(weekCount / stintWeeks);
  const drafts: RotationDraftBlock[] = [];
  // What each group has already visited, so the round-robin prefers a
  // hospital the group hasn't been to yet ("each once" per §6).
  const visited = new Map<string, Set<string>>(groups.map((g) => [g.id, new Set<string>()]));

  for (let stint = 0; stint < stintCount; stint++) {
    const remainingCapacity = new Map<string, number>(
      hospitals.map((h) => [h.id, h.capacity ?? Number.POSITIVE_INFINITY])
    );
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const seen = visited.get(group.id)!;
      // Preferred order: hospitals rotated by (stint + group index) so
      // every group starts its search at a different hospital — this is
      // what spreads groups out into a Latin square instead of every
      // group racing for the same first-choice hospital.
      const offset = (stint + i) % hospitals.length;
      const rotatedHospitals = [...hospitals.slice(offset), ...hospitals.slice(0, offset)];
      const candidates = [...rotatedHospitals.filter((h) => !seen.has(h.id)), ...rotatedHospitals];

      const chosen = candidates.find((h) => (remainingCapacity.get(h.id) ?? 0) > 0);
      if (!chosen) continue; // no hospital had room this stint — left as a gap

      remainingCapacity.set(chosen.id, (remainingCapacity.get(chosen.id) ?? 0) - 1);
      seen.add(chosen.id);

      const firstWeek = stint * stintWeeks;
      const lastWeek = Math.min(firstWeek + stintWeeks, weekCount);
      for (let weekIndex = firstWeek; weekIndex < lastWeek; weekIndex++) {
        drafts.push({ groupId: group.id, hospitalId: chosen.id, weekIndex });
      }
    }
  }

  return drafts;
}
