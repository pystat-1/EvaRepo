import { prisma } from "../db";
import { recordAudit } from "../audit";
import { isDateInScheduledDays } from "../weekdays";
import { resolveHospitalId, resolveGroupId, type ImportResult } from "../importHelpers";

export interface RotationBlock {
  id: string;
  groupId: string;
  hospitalId: string;
  hospitalName: string;
  startDate: string;
  endDate: string;
  daysOfWeek: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
}

function serialize(row: {
  id: string;
  groupId: string;
  hospitalId: string;
  hospital: { name: string };
  startDate: string;
  endDate: string;
  daysOfWeek: string | null;
  notes: string | null;
  active: boolean;
  createdAt: Date;
}): RotationBlock {
  return {
    id: row.id,
    groupId: row.groupId,
    hospitalId: row.hospitalId,
    hospitalName: row.hospital.name,
    startDate: row.startDate,
    endDate: row.endDate,
    daysOfWeek: row.daysOfWeek,
    notes: row.notes,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface RotationBlockWithGroup extends RotationBlock {
  groupName: string;
}

// All rotation blocks across all active groups, for building an overview
// timeline (see /setup) rather than one group's schedule at a time.
export async function listAllRotationBlocks(includeInactive = false): Promise<RotationBlockWithGroup[]> {
  const rows = await prisma.rotationBlock.findMany({
    where: includeInactive ? undefined : { active: true, group: { active: true } },
    orderBy: { startDate: "asc" },
    include: { hospital: { select: { name: true } }, group: { select: { name: true } } },
  });
  return rows.map((r) => ({ ...serialize(r), groupName: r.group.name }));
}

export async function listRotationBlocksForGroup(groupId: string): Promise<RotationBlock[]> {
  const rows = await prisma.rotationBlock.findMany({
    where: { groupId },
    orderBy: { startDate: "asc" },
    include: { hospital: { select: { name: true } } },
  });
  return rows.map(serialize);
}

// The hospital a group is at on a given date, resolved from its rotation
// blocks — never a static field, since groups move between hospitals on a
// schedule (see prisma/schema.prisma's RotationBlock doc comment).
export async function getActiveRotationForGroup(
  groupId: string,
  dateISO: string
): Promise<RotationBlock | undefined> {
  const row = await prisma.rotationBlock.findFirst({
    where: { groupId, active: true, startDate: { lte: dateISO }, endDate: { gte: dateISO } },
    include: { hospital: { select: { name: true } } },
  });
  return row ? serialize(row) : undefined;
}

// Same as getActiveRotationForGroup but also requires the date to match
// the block's specific attendance weekdays (daysOfWeek), not just fall
// within its start/end range — this is the "is today actually a
// scheduled attendance day" check grading enforcement needs, distinct
// from "which hospital is this group's stint at right now" display use.
export async function getScheduledRotationForDate(
  groupId: string,
  dateISO: string
): Promise<RotationBlock | undefined> {
  const rows = await prisma.rotationBlock.findMany({
    where: { groupId, active: true, startDate: { lte: dateISO }, endDate: { gte: dateISO } },
    include: { hospital: { select: { name: true } } },
  });
  const match = rows.find((r) => isDateInScheduledDays(dateISO, r.daysOfWeek));
  return match ? serialize(match) : undefined;
}

export interface CreateRotationBlockInput {
  groupId: string;
  hospitalId: string;
  startDate: string;
  endDate: string;
  daysOfWeek?: string;
  notes?: string;
}

export async function createRotationBlock(
  actorId: string,
  data: CreateRotationBlockInput
): Promise<RotationBlock> {
  if (!data.groupId) throw new Error("المجموعة مطلوبة");
  if (!data.hospitalId) throw new Error("المستشفى مطلوب");
  if (!data.startDate || !data.endDate) throw new Error("تاريخ البداية والنهاية مطلوبان");
  if (data.endDate < data.startDate) throw new Error("تاريخ النهاية يجب أن يكون بعد تاريخ البداية");

  const row = await prisma.rotationBlock.create({
    data: {
      groupId: data.groupId,
      hospitalId: data.hospitalId,
      startDate: data.startDate,
      endDate: data.endDate,
      daysOfWeek: data.daysOfWeek ?? null,
      notes: data.notes ?? null,
    },
    include: { hospital: { select: { name: true } } },
  });
  const created = serialize(row);
  await recordAudit({
    actorId,
    entityType: "RotationBlock",
    entityId: created.id,
    action: "create",
    after: created,
  });
  return created;
}

export async function toggleRotationBlockActive(
  actorId: string,
  id: string,
  active: boolean
): Promise<void> {
  const row = await prisma.rotationBlock.findUnique({ where: { id } });
  if (!row) throw new Error("Rotation block not found");
  await prisma.rotationBlock.update({ where: { id }, data: { active } });
  await recordAudit({
    actorId,
    entityType: "RotationBlock",
    entityId: id,
    action: active ? "reactivate" : "deactivate",
  });
}

// Bulk import. Rotation blocks have no natural identity to upsert by, so a
// row that exactly matches an existing active block (same group, hospital,
// date range) is skipped rather than duplicated — that's what makes
// re-importing the same schedule file idempotent — and every other row is
// always a new block (counted as "created"; there is no update path).
export async function importRotationBlocks(
  actorId: string,
  rows: Array<{ group: string; hospital: string; startDate: string; endDate: string; daysOfWeek?: string }>
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, errors: [] };

  let index = -1;
  for (const row of rows) {
    index++;
    try {
      const groupId = await resolveGroupId(row.group);
      if (!groupId) throw new Error("Missing group");
      const hospitalId = await resolveHospitalId(row.hospital);
      const startDate = row.startDate?.trim();
      const endDate = row.endDate?.trim();
      if (!startDate || !endDate) throw new Error("Missing startDate or endDate");
      const daysOfWeek = row.daysOfWeek?.trim() || undefined;

      const existing = await prisma.rotationBlock.findFirst({
        where: { groupId, hospitalId, startDate, endDate, active: true },
      });
      if (existing) {
        result.updated++;
        continue;
      }
      await createRotationBlock(actorId, { groupId, hospitalId, startDate, endDate, daysOfWeek });
      result.created++;
    } catch (err) {
      result.errors.push({ row: index + 2, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
