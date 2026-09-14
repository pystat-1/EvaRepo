import { prisma } from "../db";
import { recordAudit } from "../audit";

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
