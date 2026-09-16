// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import { prisma } from "../db";
import { recordAudit } from "../audit";
import type { ImportResult } from "../importHelpers";

export interface Hospital {
  id: string;
  name: string;
  nameAr: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function serialize(row: {
  id: string;
  name: string;
  nameAr: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Hospital {
  return {
    id: row.id,
    name: row.name,
    nameAr: row.nameAr,
    address: row.address,
    notes: row.notes,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listHospitals(includeInactive = false): Promise<Hospital[]> {
  const rows = await prisma.hospital.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: { name: "asc" },
  });
  return rows.map(serialize);
}

export async function getHospital(id: string): Promise<Hospital | undefined> {
  const row = await prisma.hospital.findUnique({ where: { id } });
  return row ? serialize(row) : undefined;
}

export async function createHospital(
  actorId: string,
  data: { name: string; nameAr?: string; address?: string; notes?: string }
): Promise<Hospital> {
  const row = await prisma.hospital.create({
    data: {
      name: data.name,
      nameAr: data.nameAr ?? null,
      address: data.address ?? null,
      notes: data.notes ?? null,
    },
  });
  const created = serialize(row);
  await recordAudit({ actorId, entityType: "Hospital", entityId: created.id, action: "create", after: created });
  return created;
}

export async function updateHospital(
  actorId: string,
  id: string,
  data: { name?: string; nameAr?: string; address?: string; notes?: string; active?: boolean }
): Promise<Hospital> {
  const beforeRow = await prisma.hospital.findUnique({ where: { id } });
  if (!beforeRow) throw new Error("Hospital not found");
  const before = serialize(beforeRow);
  const row = await prisma.hospital.update({
    where: { id },
    data: {
      name: data.name ?? before.name,
      nameAr: data.nameAr ?? before.nameAr,
      address: data.address ?? before.address,
      notes: data.notes ?? before.notes,
      active: data.active === undefined ? before.active : data.active,
    },
  });
  const after = serialize(row);
  await recordAudit({
    actorId,
    entityType: "Hospital",
    entityId: id,
    action: data.active === false ? "deactivate" : "update",
    before,
    after,
  });
  return after;
}

// Bulk import — upserts by name (falling back to nameAr) since Hospital has
// no unique key beyond id, matching how importStudents/importGroups match
// existing rows by their own natural-language identity column.
export async function importHospitals(
  actorId: string,
  rows: Array<{ name: string; nameAr?: string; address?: string; notes?: string }>
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, errors: [] };

  let index = -1;
  for (const row of rows) {
    index++;
    try {
      if (!row.name?.trim()) throw new Error("Missing hospital name");
      const existing = await prisma.hospital.findFirst({
        where: { OR: [{ name: row.name.trim() }, ...(row.nameAr?.trim() ? [{ nameAr: row.nameAr.trim() }] : [])] },
      });
      if (existing) {
        await updateHospital(actorId, existing.id, {
          name: row.name.trim(),
          nameAr: row.nameAr,
          address: row.address,
          notes: row.notes,
        });
        result.updated++;
      } else {
        await createHospital(actorId, {
          name: row.name.trim(),
          nameAr: row.nameAr,
          address: row.address,
          notes: row.notes,
        });
        result.created++;
      }
    } catch (err) {
      result.errors.push({ row: index + 2, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
