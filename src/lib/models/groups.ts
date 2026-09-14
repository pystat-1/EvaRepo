// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import { prisma } from "../db";
import { recordAudit } from "../audit";

export interface Group {
  id: string;
  name: string;
  cycleLabel: string | null;
  hospitalId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GroupWithHospital extends Group {
  hospitalName: string | null;
  studentCount: number;
}

function serialize(row: {
  id: string;
  name: string;
  cycleLabel: string | null;
  hospitalId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Group {
  return {
    id: row.id,
    name: row.name,
    cycleLabel: row.cycleLabel,
    hospitalId: row.hospitalId,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listGroups(includeInactive = false): Promise<GroupWithHospital[]> {
  const rows = await prisma.group.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: { name: "asc" },
    include: {
      hospital: { select: { name: true } },
      _count: { select: { students: { where: { active: true } } } },
    },
  });
  return rows.map((r: any) => ({
    ...serialize(r),
    hospitalName: r.hospital?.name ?? null,
    studentCount: r._count.students,
  }));
}

export async function getGroup(id: string): Promise<Group | undefined> {
  const row = await prisma.group.findUnique({ where: { id } });
  return row ? serialize(row) : undefined;
}

export async function createGroup(
  actorId: string,
  data: { name: string; cycleLabel?: string; hospitalId?: string | null }
): Promise<Group> {
  const row = await prisma.group.create({
    data: {
      name: data.name,
      cycleLabel: data.cycleLabel ?? null,
      hospitalId: data.hospitalId ?? null,
    },
  });
  const created = serialize(row);
  await recordAudit({ actorId, entityType: "Group", entityId: created.id, action: "create", after: created });
  return created;
}

export async function updateGroup(
  actorId: string,
  id: string,
  data: { name?: string; cycleLabel?: string; hospitalId?: string | null; active?: boolean }
): Promise<Group> {
  const beforeRow = await prisma.group.findUnique({ where: { id } });
  if (!beforeRow) throw new Error("Group not found");
  const before = serialize(beforeRow);
  const row = await prisma.group.update({
    where: { id },
    data: {
      name: data.name ?? before.name,
      cycleLabel: data.cycleLabel ?? before.cycleLabel,
      hospitalId: data.hospitalId === undefined ? before.hospitalId : data.hospitalId,
      active: data.active === undefined ? before.active : data.active,
    },
  });
  const after = serialize(row);
  await recordAudit({
    actorId,
    entityType: "Group",
    entityId: id,
    action: data.active === false ? "deactivate" : "update",
    before,
    after,
  });
  return after;
}
