// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import { prisma } from "../db";
import { recordAudit } from "../audit";

export interface StudyType {
  id: string;
  name: string;
  nameAr: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function serialize(row: {
  id: string;
  name: string;
  nameAr: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): StudyType {
  return {
    id: row.id,
    name: row.name,
    nameAr: row.nameAr,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listStudyTypes(includeInactive = false): Promise<StudyType[]> {
  const rows = await prisma.studyType.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: { name: "asc" },
  });
  return rows.map(serialize);
}

export async function getStudyType(id: string): Promise<StudyType | undefined> {
  const row = await prisma.studyType.findUnique({ where: { id } });
  return row ? serialize(row) : undefined;
}

export async function createStudyType(
  actorId: string,
  data: { name: string; nameAr?: string }
): Promise<StudyType> {
  const row = await prisma.studyType.create({
    data: { name: data.name, nameAr: data.nameAr ?? null },
  });
  const created = serialize(row);
  await recordAudit({ actorId, entityType: "StudyType", entityId: created.id, action: "create", after: created });
  return created;
}

export async function updateStudyType(
  actorId: string,
  id: string,
  data: { name?: string; nameAr?: string; active?: boolean }
): Promise<StudyType> {
  const beforeRow = await prisma.studyType.findUnique({ where: { id } });
  if (!beforeRow) throw new Error("Study type not found");
  const before = serialize(beforeRow);
  const row = await prisma.studyType.update({
    where: { id },
    data: {
      name: data.name ?? before.name,
      nameAr: data.nameAr ?? before.nameAr,
      active: data.active === undefined ? before.active : data.active,
    },
  });
  const after = serialize(row);
  await recordAudit({
    actorId,
    entityType: "StudyType",
    entityId: id,
    action: data.active === false ? "deactivate" : "update",
    before,
    after,
  });
  return after;
}
