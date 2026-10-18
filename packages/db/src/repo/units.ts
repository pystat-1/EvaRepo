// توزيع الأقسام: which hospital unit (صالة الولادة، العناية…) each student
// is in on each attendance day. The units are one standard list; a day
// without a unit is simply not set. Evaluators see the unit next to each
// name on their phones (sync.ts puts it in the bundle).
import { and, asc, eq, inArray } from "drizzle-orm";
import { attendanceDatesOf } from "@eva/core/schedule/holidays";
import { compareArabic } from "@eva/core/text/arabic";
import * as t from "../schema";
import { Plan, ValidationError, newId, nowISO, type Repo } from "./common";
import { listHolidays } from "./courses";

export interface Unit {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export async function listUnits(r: Repo, includeInactive = false): Promise<Unit[]> {
  return r.db
    .select({ id: t.units.id, name: t.units.name, sortOrder: t.units.sortOrder, active: t.units.active })
    .from(t.units)
    .where(includeInactive ? undefined : eq(t.units.active, true))
    .orderBy(asc(t.units.sortOrder), asc(t.units.name));
}

/** Adds a unit to the standard list, or renames one. */
export async function saveUnit(r: Repo, input: { id?: string; name: string }): Promise<string> {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name) throw new ValidationError("اسم القسم مطلوب", "name");
  const [clash] = await r.db.select({ id: t.units.id }).from(t.units).where(eq(t.units.name, name));
  if (clash && clash.id !== input.id) throw new ValidationError("يوجد قسم بهذا الاسم", "name");
  const plan = new Plan(r);
  const id = input.id ?? newId();
  if (input.id) plan.add(r.db.update(t.units).set({ name, updatedAt: nowISO() }).where(eq(t.units.id, id)));
  else {
    const last = (await listUnits(r, true)).reduce((m, u) => Math.max(m, u.sortOrder), 0);
    plan.add(r.db.insert(t.units).values({ id, name, sortOrder: last + 1 }));
  }
  plan.audit("Unit", id, input.id ? "update" : "create", undefined, { name });
  await plan.commit();
  return id;
}

/** Hides a unit from the choices (days already set keep it). */
export async function setUnitActive(r: Repo, id: string, active: boolean) {
  const plan = new Plan(r);
  plan.add(r.db.update(t.units).set({ active, updatedAt: nowISO() }).where(eq(t.units.id, id)));
  plan.audit("Unit", id, active ? "reactivate" : "deactivate");
  await plan.commit();
}

export interface UnitPlan {
  /** The group's attendance days (holidays out, make-up days in). */
  dates: string[];
  students: Array<{ id: string; nameAr: string; universityNumber: string }>;
  /** studentId -> dateISO -> unitId. */
  cells: Record<string, Record<string, string>>;
}

/** One group's unit grid: its students × its attendance days. */
export async function unitPlan(r: Repo, groupId: string): Promise<UnitPlan> {
  const [group] = await r.db.select().from(t.groups).where(eq(t.groups.id, groupId));
  if (!group) throw new ValidationError("المجموعة غير موجودة");
  const blocks = await r.db
    .select()
    .from(t.rotationBlocks)
    .where(and(eq(t.rotationBlocks.groupId, groupId), eq(t.rotationBlocks.active, true)));
  const holidays = group.courseId ? await listHolidays(r, group.courseId) : [];
  const students = (
    await r.db
      .select({ id: t.students.id, nameAr: t.students.nameAr, universityNumber: t.students.universityNumber })
      .from(t.students)
      .where(and(eq(t.students.groupId, groupId), eq(t.students.active, true)))
  ).sort((a, b) => compareArabic(a.nameAr, b.nameAr));
  const rows = students.length
    ? await r.db.select().from(t.studentDayUnits).where(inArray(t.studentDayUnits.studentId, students.map((s) => s.id)))
    : [];
  const cells: UnitPlan["cells"] = {};
  for (const x of rows) (cells[x.studentId] ??= {})[x.dateISO] = x.unitId;
  return { dates: attendanceDatesOf(blocks, holidays, groupId), students, cells };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

async function checkUnit(r: Repo, unitId: string | null) {
  if (!unitId) return;
  const [u] = await r.db.select({ id: t.units.id }).from(t.units).where(eq(t.units.id, unitId));
  if (!u) throw new ValidationError("القسم غير موجود", "unitId");
}

function put(r: Repo, plan: Plan, studentId: string, dateISO: string, unitId: string | null) {
  if (!unitId) {
    plan.add(r.db.delete(t.studentDayUnits).where(and(eq(t.studentDayUnits.studentId, studentId), eq(t.studentDayUnits.dateISO, dateISO))));
    return;
  }
  plan.add(
    r.db
      .insert(t.studentDayUnits)
      .values({ id: newId(), studentId, dateISO, unitId })
      .onConflictDoUpdate({ target: [t.studentDayUnits.studentId, t.studentDayUnits.dateISO], set: { unitId, updatedAt: nowISO() } })
  );
}

/** Sets (or clears, with null) one student's unit on one day. */
export async function setStudentUnit(r: Repo, studentId: string, dateISO: string, unitId: string | null) {
  if (!ISO_DAY.test(dateISO)) throw new ValidationError("تاريخ غير صالح", "dateISO");
  await checkUnit(r, unitId);
  const plan = new Plan(r);
  put(r, plan, studentId, dateISO, unitId);
  plan.audit("StudentDayUnit", studentId, unitId ? "update" : "delete", undefined, { dateISO, unitId });
  await plan.commit();
}

/** Sets (or clears) one day's unit for every student of the group. */
export async function setGroupDayUnit(r: Repo, groupId: string, dateISO: string, unitId: string | null) {
  if (!ISO_DAY.test(dateISO)) throw new ValidationError("تاريخ غير صالح", "dateISO");
  await checkUnit(r, unitId);
  const students = await r.db
    .select({ id: t.students.id })
    .from(t.students)
    .where(and(eq(t.students.groupId, groupId), eq(t.students.active, true)));
  const plan = new Plan(r);
  for (const s of students) put(r, plan, s.id, dateISO, unitId);
  plan.audit("StudentDayUnit", groupId, "update", undefined, { name: "قسم اليوم للمجموعة كلها", dateISO, unitId });
  await plan.commit();
}

/** Many days at once (studentId, dateISO, unitId), in one transaction — for scripts and imports. */
export async function setUnits(r: Repo, rows: Array<{ studentId: string; dateISO: string; unitId: string | null }>) {
  const plan = new Plan(r);
  for (const x of rows) {
    if (!ISO_DAY.test(x.dateISO)) throw new ValidationError("تاريخ غير صالح", "dateISO");
    put(r, plan, x.studentId, x.dateISO, x.unitId);
  }
  plan.audit("StudentDayUnit", "batch", "update", undefined, { count: rows.length });
  await plan.commit();
}

/** studentId -> dateISO -> unit name, for these students (the phones' bundles). */
export async function unitNamesByStudent(r: Repo, studentIds: string[]): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  if (studentIds.length === 0) return out;
  const rows = await r.db
    .select({ studentId: t.studentDayUnits.studentId, dateISO: t.studentDayUnits.dateISO, name: t.units.name })
    .from(t.studentDayUnits)
    .innerJoin(t.units, eq(t.units.id, t.studentDayUnits.unitId))
    .where(inArray(t.studentDayUnits.studentId, studentIds));
  for (const x of rows) out.set(x.studentId, { ...(out.get(x.studentId) ?? {}), [x.dateISO]: x.name });
  return out;
}
