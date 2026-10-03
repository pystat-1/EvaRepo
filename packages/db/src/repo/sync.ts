// Desktop side of phone sync (docs/adr/0002, docs/FLOWS.md §2 and §4):
// build each evaluator's bundle, apply validated days pulled from the
// relay (one transaction per day, all checks re-done here because the
// desktop is the source of truth), and let the admin resolve conflicts.
import { and, eq, inArray } from "drizzle-orm";
import { applyItemScores, normalizeScoresForAttendance, round2, validateScores } from "@eva/core/grading/validation";
import { pickPlacement } from "@eva/core/grading/placement";
import { withMakeupDays } from "@eva/core/schedule/holidays";
import { BUNDLE_FORMAT, checkDaySubmission, type DaySubmission, type EvaluatorBundle, type HistoryDay, type SubmissionResult } from "@eva/core/sync/contract";
import { sha256Hex } from "@eva/core/sync/tokens";
import { compareArabic } from "@eva/core/text/arabic";
import * as t from "../schema";
import { Plan, ValidationError, newId, nowISO, type Repo } from "./common";
import { currentCourse } from "./students";
import { autoName } from "./evaluators";
import { listHolidays } from "./courses";

// ---- publishing ----------------------------------------------------------

export interface PublishedEvaluator {
  id: string;
  email: string;
  name: string;
  active: boolean;
}

async function rubricWithItems(r: Repo) {
  const sections = (await r.db.select().from(t.rubricSections).where(eq(t.rubricSections.active, true))).sort((a, b) => a.sortOrder - b.sortOrder);
  const items = await r.db.select().from(t.rubricItems).where(eq(t.rubricItems.active, true));
  return sections.map((s) => ({
    id: s.id,
    labelAr: s.labelAr,
    labelEn: s.labelEn,
    maxScore: s.maxScore,
    items: items
      .filter((i) => i.sectionId === s.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({ id: i.id, labelAr: i.labelAr, labelEn: i.labelEn, maxScore: i.maxScore, kind: i.kind })),
  }));
}

/** Everything the relay needs: evaluator logins and one bundle per active evaluator. */
export async function buildPublication(r: Repo): Promise<{ evaluators: PublishedEvaluator[]; bundles: EvaluatorBundle[] }> {
  const course = await currentCourse(r);
  const accounts = await r.db.select().from(t.accounts).where(eq(t.accounts.role, "EVALUATOR"));
  // Evaluators sign in with the Google account of this email: only the
  // email, name and active flag leave this computer.
  const evaluators = accounts.map((a) => ({ id: a.id, email: a.email, name: a.name, active: a.active }));
  if (!course) return { evaluators, bundles: [] };

  const rubric = await rubricWithItems(r);
  const assignments = await r.db
    .select()
    .from(t.evaluatorAssignments)
    .where(and(eq(t.evaluatorAssignments.courseId, course.id), eq(t.evaluatorAssignments.active, true)));
  const blocks = await r.db
    .select({ b: t.rotationBlocks, hospitalName: t.hospitals.name })
    .from(t.rotationBlocks)
    .innerJoin(t.hospitals, eq(t.hospitals.id, t.rotationBlocks.hospitalId))
    .where(and(eq(t.rotationBlocks.courseId, course.id), eq(t.rotationBlocks.active, true)));
  const groups = await r.db.select().from(t.groups).where(eq(t.groups.courseId, course.id));
  const students = await r.db.select().from(t.students).where(and(eq(t.students.courseId, course.id), eq(t.students.active, true)));
  const history = await courseHistory(r, course.id, accounts);
  const holidays = await listHolidays(r, course.id);

  const bundles: EvaluatorBundle[] = [];
  for (const acc of accounts.filter((a) => a.active)) {
    const mine = assignments.filter((a) => a.accountId === acc.id);
    if (mine.length === 0) continue;
    const hospitalIds = new Set(mine.map((a) => a.hospitalId));
    const onlyGroups = new Set(mine.filter((a) => a.groupId).map((a) => a.groupId!));
    const myBlocks = blocks.filter((x) => hospitalIds.has(x.b.hospitalId) && (onlyGroups.size === 0 || onlyGroups.has(x.b.groupId)));
    const groupIds = [...new Set(myBlocks.map((x) => x.b.groupId))];
    const myGroups = new Set(groupIds);
    const body = {
      format: BUNDLE_FORMAT,
      evaluator: { id: acc.id, name: acc.name },
      course: { id: course.id, label: course.label ?? `${course.year}-${course.number}`, startDate: course.startDate },
      hospitals: [...new Map(myBlocks.map((x) => [x.b.hospitalId, { id: x.b.hospitalId, name: x.hospitalName }])).values()],
      groups: groups
        .filter((g) => groupIds.includes(g.id))
        .sort((a, b) => (a.shift ?? "").localeCompare(b.shift ?? "") * -1 || a.name.localeCompare(b.name, "ar", { numeric: true }))
        .map((g) => ({
          id: g.id,
          name: g.name,
          shift: g.shift,
          students: students
            .filter((s) => s.groupId === g.id)
            .sort((a, b) => compareArabic(a.nameAr, b.nameAr))
            .map((s) => ({ id: s.id, name: s.nameAr, universityNumber: s.universityNumber })),
        })),
      stints: myBlocks
        .map((x) => ({ groupId: x.b.groupId, hospitalId: x.b.hospitalId, hospitalName: x.hospitalName, startDate: x.b.startDate, endDate: x.b.endDate, daysOfWeek: x.b.daysOfWeek }))
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.groupId.localeCompare(b.groupId)),
      holidays,
      rubric,
      // Days graded at this evaluator's hospitals for their groups.
      history: history.filter((d) => myGroups.has(d.groupId) && d.hospitalId !== null && hospitalIds.has(d.hospitalId)),
    };
    const version = (await sha256Hex(JSON.stringify(body))).slice(0, 16);
    bundles.push({ ...body, version, generatedAt: nowISO() } as EvaluatorBundle);
  }
  return { evaluators, bundles };
}

/** Every validated day of the course, grouped by group + date + evaluator (for the bundles' history). */
async function courseHistory(r: Repo, courseId: string, accounts: Array<{ id: string; name: string }>): Promise<HistoryDay[]> {
  const evals = await r.db
    .select()
    .from(t.evaluations)
    .where(and(eq(t.evaluations.courseId, courseId), eq(t.evaluations.pendingValidation, false)));
  if (evals.length === 0) return [];
  const scores = await r.db
    .select({ evaluationId: t.evaluationScores.evaluationId, sectionId: t.evaluationScores.rubricSectionId, score: t.evaluationScores.score })
    .from(t.evaluationScores)
    .innerJoin(t.evaluations, eq(t.evaluations.id, t.evaluationScores.evaluationId))
    .where(and(eq(t.evaluations.courseId, courseId), eq(t.evaluations.pendingValidation, false)));
  const notes = await r.db
    .select({ studentId: t.attendanceRecords.studentId, dateISO: t.attendanceRecords.dateISO, dailyNote: t.attendanceRecords.dailyNote })
    .from(t.attendanceRecords);
  const noteOf = new Map(notes.map((n) => [`${n.studentId}:${n.dateISO}`, n.dailyNote]));
  const sectionsOf = new Map<string, Record<string, number>>();
  for (const s of scores) sectionsOf.set(s.evaluationId, { ...(sectionsOf.get(s.evaluationId) ?? {}), [s.sectionId]: s.score });
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
  const days = new Map<string, HistoryDay>();
  for (const e of evals) {
    if (!e.groupId) continue;
    const key = `${e.groupId}:${e.dateISO}:${e.evaluatorId}`;
    let d = days.get(key);
    if (!d) {
      d = { groupId: e.groupId, dateISO: e.dateISO, hospitalId: e.hospitalId, evaluatorId: e.evaluatorId, evaluatorName: nameOf.get(e.evaluatorId) ?? "—", records: [] };
      days.set(key, d);
    }
    const note = noteOf.get(`${e.studentId}:${e.dateISO}`);
    d.records.push({
      studentId: e.studentId,
      attendance: e.attendance,
      dailyNote: e.attendance === "absent" ? null : note ?? e.dailyNoteSubmitted,
      total: e.total,
      sections: sectionsOf.get(e.id) ?? {},
      items: e.itemScores ?? null,
      ...(e.notes ? { notes: e.notes } : {}),
    });
  }
  return [...days.values()]
    .map((d) => ({ ...d, records: d.records.sort((a, b) => a.studentId.localeCompare(b.studentId)) }))
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || a.groupId.localeCompare(b.groupId));
}

// ---- phone sign-ins ------------------------------------------------------

/** An evaluator who has signed in on a phone (reported by the relay). */
export interface PhoneSignIn {
  id: string;
  googleName: string | null;
  lastLoginAt: string;
  lastSeenAt: string | null;
}

/**
 * Remembers who has signed in on a phone, and gives an evaluator added
 * with the email only (name = the email's user part) the name on their
 * Google account.
 */
export async function recordPhoneSignIns(r: Repo, phones: PhoneSignIn[]): Promise<number> {
  await setSetting(r, "relay.phones", JSON.stringify(phones));
  const accounts = await r.db.select().from(t.accounts).where(eq(t.accounts.role, "EVALUATOR"));
  const plan = new Plan(r);
  for (const p of phones) {
    const acc = accounts.find((a) => a.id === p.id);
    const googleName = p.googleName?.replace(/\s+/g, " ").trim();
    if (!acc || !googleName || acc.name !== autoName(acc.email)) continue;
    plan.add(r.db.update(t.accounts).set({ name: googleName, updatedAt: nowISO() }).where(eq(t.accounts.id, acc.id)));
    plan.audit("Evaluator", acc.id, "update", { name: acc.name }, { name: googleName });
  }
  const renamed = plan.statements.length / 2; // one update + one audit entry each
  if (renamed) await plan.commit();
  return renamed;
}

export async function phoneSignIns(r: Repo): Promise<Map<string, PhoneSignIn>> {
  const raw = await getSetting(r, "relay.phones");
  const list = raw ? (JSON.parse(raw) as PhoneSignIn[]) : [];
  return new Map(list.map((p) => [p.id, p]));
}

// ---- applying pulled submissions ------------------------------------------

export interface PulledSubmission {
  seq: number;
  receivedAt: string;
  submission: DaySubmission;
}

/**
 * Applies one validated day. Always records the outcome in sync_inbox, so
 * receiving the same clientId again returns the stored result and changes
 * nothing. `force` (admin override) replaces other evaluators' grades.
 */
export async function applyDaySubmission(r: Repo, pulled: PulledSubmission, force = false): Promise<SubmissionResult> {
  const sub = pulled.submission;
  const [seen] = await r.db.select().from(t.syncInbox).where(eq(t.syncInbox.clientId, sub.clientId));
  if (seen && !force) return { clientId: sub.clientId, outcome: seen.status, message: seen.message };

  const reject = (message: string) => record("rejected", message);
  async function record(status: SubmissionResult["outcome"], message: string, plan = new Plan(r)): Promise<SubmissionResult> {
    const row = {
      relaySeq: pulled.seq,
      evaluatorId: sub.evaluatorId,
      groupId: sub.groupId,
      dateISO: sub.dateISO,
      payload: JSON.stringify(sub),
      receivedAt: pulled.receivedAt,
      status,
      message,
      decidedAt: nowISO(),
      reported: false,
    };
    plan.add(r.db.insert(t.syncInbox).values({ clientId: sub.clientId, ...row }).onConflictDoUpdate({ target: t.syncInbox.clientId, set: row }));
    await plan.commit();
    return { clientId: sub.clientId, outcome: status, message };
  }

  const shape = checkDaySubmission(sub);
  if (shape) return reject(shape);

  const [evaluator] = await r.db.select().from(t.accounts).where(eq(t.accounts.id, sub.evaluatorId));
  if (!evaluator || evaluator.role !== "EVALUATOR" || !evaluator.active) return reject("حساب المقيّم غير فعّال");
  const [group] = await r.db.select().from(t.groups).where(eq(t.groups.id, sub.groupId));
  if (!group) return reject("المجموعة غير موجودة");

  // Scope: the group must be at one of this evaluator's hospitals around that date.
  const assignments = await r.db
    .select()
    .from(t.evaluatorAssignments)
    .where(and(eq(t.evaluatorAssignments.accountId, evaluator.id), eq(t.evaluatorAssignments.active, true)));
  const hospitals = new Set(assignments.map((a) => a.hospitalId));
  const blocks = await r.db
    .select({ b: t.rotationBlocks, hospitalName: t.hospitals.name })
    .from(t.rotationBlocks)
    .innerJoin(t.hospitals, eq(t.hospitals.id, t.rotationBlocks.hospitalId))
    .where(and(eq(t.rotationBlocks.groupId, group.id), eq(t.rotationBlocks.active, true)));
  const stints = blocks
    .filter((x) => hospitals.has(x.b.hospitalId))
    .map((x) => ({ groupId: x.b.groupId, hospitalId: x.b.hospitalId, hospitalName: x.hospitalName, startDate: x.b.startDate, endDate: x.b.endDate, daysOfWeek: x.b.daysOfWeek }));
  // Holidays: a make-up day counts as scheduled at the moved day's hospital; the holiday itself does not.
  const holidays = group.courseId ? await listHolidays(r, group.courseId) : [];
  const found = pickPlacement(withMakeupDays(stints, holidays), group.id, sub.dateISO);
  if (!found) return reject("هذه المجموعة ليست في مستشفيات هذا المقيّم في ذلك التاريخ");
  const placement = holidays.some((h) => h.dateISO === sub.dateISO) ? { ...found, scheduled: false } : found;

  const members = new Set(
    (await r.db.select({ id: t.students.id }).from(t.students).where(eq(t.students.groupId, group.id))).map((s) => s.id)
  );
  const outsider = sub.records.find((x) => !members.has(x.studentId));
  if (outsider) return reject("سجل لطالب ليس في هذه المجموعة");

  // Scores: validated against the desktop's own rubric.
  const rubric = await rubricWithItems(r);
  const sections = rubric.map((s) => ({ id: s.id, labelAr: s.labelAr, maxScore: s.maxScore, items: s.items }));
  const itemIds = new Set(rubric.flatMap((s) => s.items.map((i) => i.id)));
  const prepared: Array<{ rec: DaySubmission["records"][number]; scores: Record<string, number>; itemScores: Record<string, number>; total: number }> = [];
  try {
    for (const rec of sub.records) {
      const itemScores = Object.fromEntries(Object.entries(rec.scores).filter(([k]) => itemIds.has(k)));
      const plain = Object.fromEntries(Object.entries(rec.scores).filter(([k]) => !itemIds.has(k)));
      const absent = rec.attendance === "absent";
      const applied = applyItemScores(plain, absent ? {} : itemScores, sections);
      const scores = normalizeScoresForAttendance(rec.attendance, applied.scores, sections);
      validateScores(scores, sections);
      prepared.push({ rec, scores, itemScores: applied.itemScores, total: round2(Object.values(scores).reduce((a, b) => a + b, 0)) });
    }
  } catch (e) {
    return reject(`درجات غير صالحة: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Conflicts: another evaluator already has a grade for one of these student-days.
  const existing = await r.db
    .select()
    .from(t.evaluations)
    .where(and(eq(t.evaluations.dateISO, sub.dateISO), inArray(t.evaluations.studentId, sub.records.map((x) => x.studentId))));
  const others = existing.filter((e) => e.evaluatorId !== evaluator.id);
  if (others.length > 0 && !force) {
    return record("conflict", `يوجد تقييم لنفس اليوم من مقيّم آخر لـ ${others.length} طالب — بانتظار قرار المدير`);
  }

  // Apply the whole day atomically.
  const plan = new Plan(r);
  const stamp = nowISO();
  const byStudent = new Map(existing.map((e) => [e.studentId, e]));
  for (const p of prepared) {
    const prev = byStudent.get(p.rec.studentId);
    const evaluationId = prev?.id ?? newId();
    const fields = {
      evaluatorId: evaluator.id,
      groupId: group.id,
      hospitalId: placement.hospitalId,
      attendance: p.rec.attendance,
      notes: p.rec.notes?.trim() || null,
      dailyNoteSubmitted: p.rec.attendance !== "absent" && p.rec.dailyNote === true,
      itemScores: p.itemScores,
      total: p.total,
      pendingValidation: false,
      locked: true,
      lockedAt: stamp,
      lockedById: evaluator.id,
      courseId: group.courseId,
      lastSubmissionId: sub.clientId,
      updatedAt: stamp,
    };
    plan.add(
      r.db
        .insert(t.evaluations)
        .values({ id: evaluationId, studentId: p.rec.studentId, dateISO: sub.dateISO, ...fields })
        .onConflictDoUpdate({ target: [t.evaluations.studentId, t.evaluations.dateISO], set: fields })
    );
    plan.add(r.db.delete(t.evaluationScores).where(eq(t.evaluationScores.evaluationId, evaluationId)));
    for (const [rubricSectionId, score] of Object.entries(p.scores)) {
      const sec = sections.find((s) => s.id === rubricSectionId)!;
      plan.add(r.db.insert(t.evaluationScores).values({ id: newId(), evaluationId, rubricSectionId, score, labelArAtTime: sec.labelAr, maxScoreAtTime: sec.maxScore }));
    }
    const note = p.rec.attendance === "absent" ? null : p.rec.dailyNote;
    const att = { groupId: group.id, hospitalId: placement.hospitalId, status: p.rec.attendance, markedAt: stamp, markedById: evaluator.id, dailyNote: note, dailyNoteAt: note === null ? null : stamp, dailyNoteById: note === null ? null : evaluator.id, updatedAt: stamp };
    plan.add(
      r.db
        .insert(t.attendanceRecords)
        .values({ id: newId(), studentId: p.rec.studentId, dateISO: sub.dateISO, ...att })
        .onConflictDoUpdate({ target: [t.attendanceRecords.studentId, t.attendanceRecords.dateISO], set: att })
    );
  }
  const day = { hospitalId: placement.hospitalId, scheduled: placement.scheduled, validatedAt: stamp, validatedById: evaluator.id, updatedAt: stamp };
  plan.add(
    r.db
      .insert(t.groupWorkDays)
      .values({ id: newId(), groupId: group.id, dateISO: sub.dateISO, startedById: evaluator.id, ...day })
      .onConflictDoUpdate({ target: [t.groupWorkDays.groupId, t.groupWorkDays.dateISO], set: day })
  );
  plan.audit("GroupWorkDay", `${group.id}:${sub.dateISO}`, force ? "update" : "create", undefined, {
    source: "phone",
    evaluator: evaluator.name,
    students: prepared.length,
    replaced: force ? others.length : 0,
  });
  const msg = force ? `طُبّق بقرار المدير (استُبدل ${others.length} تقييم)` : `اعتُمد ${prepared.length} تقييم${placement.scheduled ? "" : " (يوم خارج الجدول)"}`;
  return record("applied", msg, plan);
}

export async function inbox(r: Repo, status?: "applied" | "conflict" | "rejected") {
  const rows = await r.db.select().from(t.syncInbox).where(status ? eq(t.syncInbox.status, status) : undefined);
  return rows.sort((a, b) => b.relaySeq - a.relaySeq);
}

/** Admin decision on a conflict: apply this phone's day, replacing the other grades. */
export async function applyConflictAnyway(r: Repo, clientId: string): Promise<SubmissionResult> {
  const [row] = await r.db.select().from(t.syncInbox).where(eq(t.syncInbox.clientId, clientId));
  if (!row) throw new ValidationError("السجل غير موجود");
  if (row.status !== "conflict") throw new ValidationError("هذا السجل ليس تعارضًا");
  return applyDaySubmission(r, { seq: row.relaySeq, receivedAt: row.receivedAt, submission: JSON.parse(row.payload) as DaySubmission }, true);
}

/** Outcomes not yet sent back to the relay (so phones can show them). */
export async function unreportedResults(r: Repo): Promise<SubmissionResult[]> {
  const rows = await r.db.select().from(t.syncInbox).where(eq(t.syncInbox.reported, false));
  return rows.map((x) => ({ clientId: x.clientId, outcome: x.status, message: x.message }));
}

export async function markReported(r: Repo, clientIds: string[]) {
  if (clientIds.length === 0) return;
  await r.exec.batch([r.db.update(t.syncInbox).set({ reported: true }).where(inArray(t.syncInbox.clientId, clientIds)).toSQL()]);
}

// ---- small key/value settings (relay URL, admin key, pull cursor) ----------

export async function getSetting(r: Repo, key: string): Promise<string | null> {
  const [row] = await r.db.select().from(t.meta).where(eq(t.meta.key, key));
  return row?.value ?? null;
}

export async function setSetting(r: Repo, key: string, value: string) {
  await r.exec.batch([r.db.insert(t.meta).values({ key, value }).onConflictDoUpdate({ target: t.meta.key, set: { value } }).toSQL()]);
}
