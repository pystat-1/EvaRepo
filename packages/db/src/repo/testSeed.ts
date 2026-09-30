// Test fixture (tests only): a fresh in-memory database shaped like the
// real course: 3 hospitals, 2 shifts x 3 groups, 2-week stints, the
// 15-point rubric, 2 evaluators, and `perGroup` sample students per group.
import { openBetterSqlite } from "../betterSqlite";
import { migrate } from "../migrate";
import * as t from "../schema";
import { repo, type Repo } from "./common";

export const IDS = {
  course: "c1",
  hospitals: ["h-yarmouk", "h-medcity", "h-alawiya"],
  evaluators: ["e-sara", "e-ali"],
};

export function groupId(shift: "MORNING" | "EVENING", n: number) {
  return `g-${shift === "MORNING" ? "m" : "e"}${n}`;
}

const addDays = (iso: string, d: number) => {
  const x = new Date(`${iso}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};

export async function seeded(perGroup = 2): Promise<Repo & { raw: ReturnType<typeof openBetterSqlite>["db"] }> {
  const { db: raw, exec } = openBetterSqlite(":memory:");
  await migrate(exec);
  const r = repo(exec);
  const d = r.db;
  await d.insert(t.studyTypes).values({ id: "st-n", name: "Nursing", nameAr: "التمريض", code: "N" });
  await d.insert(t.courses).values({ id: IDS.course, year: 2026, number: 1, label: "دورة التمريض الأولى 2026", status: "PUBLISHED", startDate: "2026-10-04", weekCount: 6 });
  await d.insert(t.courseStudyTypes).values({ id: "cst1", courseId: IDS.course, studyTypeId: "st-n" });
  const names = ["مستشفى اليرموك", "مستشفى مدينة الطب", "مستشفى العلوية"];
  for (let i = 0; i < 3; i++) {
    await d.insert(t.hospitals).values({ id: IDS.hospitals[i], name: names[i], nameAr: names[i] });
    await d.insert(t.courseHospitals).values({ id: `ch${i}`, courseId: IDS.course, hospitalId: IDS.hospitals[i] });
  }
  let seq = 0;
  for (const shift of ["MORNING", "EVENING"] as const) {
    for (let g = 1; g <= 3; g++) {
      const gid = groupId(shift, g);
      await d.insert(t.groups).values({ id: gid, name: `المجموعة ${shift === "MORNING" ? "الصباحية" : "المسائية"} ${g}`, courseId: IDS.course, shift, studyTypeId: "st-n" });
      for (let k = 0; k < perGroup; k++) {
        seq++;
        await d.insert(t.students).values({
          id: `s${seq}`, universityNumber: `SMP-${String(seq).padStart(3, "0")}`, nameAr: `طالب ${seq}`,
          code: `26-1-N-${String(seq).padStart(4, "0")}`, groupId: gid, courseId: IDS.course, shift, studyTypeId: "st-n",
        });
      }
      for (let w = 0; w < 6; w++) {
        const start = addDays("2026-10-04", w * 7);
        await d.insert(t.rotationBlocks).values({
          id: `b-${gid}-w${w}`, groupId: gid, hospitalId: IDS.hospitals[(g - 1 + Math.floor(w / 2)) % 3],
          courseId: IDS.course, weekIndex: w, startDate: start, endDate: addDays(start, 4), daysOfWeek: "SUN,MON,TUE,WED,THU",
        });
      }
    }
  }
  const sections = [["الملاحظة اليومية", 5], ["المناقشة والتغذية الراجعة", 7], ["الموقف والتواصل", 1], ["الانتظام", 1], ["المظهر", 1]] as const;
  for (let i = 0; i < sections.length; i++) {
    await d.insert(t.rubricSections).values({ id: `rs${i}`, labelAr: sections[i][0], maxScore: sections[i][1], sortOrder: i + 1 });
  }
  // The real rubric's items (فقرات): 5 + 3.5+3.5 + four 0.25 checks x 3.
  const items: Array<[string, string, string, number, "check" | "number"]> = [
    ["dailynote", "rs0", "الملاحظة اليومية", 5, "number"],
    ["gdisc", "rs1", "مناقشة جماعية", 3.5, "number"],
    ["cdisc", "rs1", "مناقشة الحالة", 3.5, "number"],
    ...(["staff", "std", "tchr", "pat"].map((k) => [k, "rs2", k, 0.25, "check"]) as Array<[string, string, string, number, "check"]>),
    ...(["late", "meet", "loc", "ord"].map((k) => [k, "rs3", k, 0.25, "check"]) as Array<[string, string, string, number, "check"]>),
    ...(["badge", "veil", "uni", "coat"].map((k) => [k, "rs4", k, 0.25, "check"]) as Array<[string, string, string, number, "check"]>),
  ];
  await d.insert(t.rubricItems).values(items.map(([key, sectionId, labelAr, maxScore, kind], i) => ({ id: `ri-${key}`, key, sectionId, labelAr, maxScore, kind, sortOrder: i })));
  await d.insert(t.accounts).values([
    { id: IDS.evaluators[0], email: "sara@x.iq", name: "د. سارة", role: "EVALUATOR" },
    { id: IDS.evaluators[1], email: "ali@x.iq", name: "م. علي", role: "EVALUATOR" },
  ]);
  await d.insert(t.evaluatorAssignments).values([
    { id: "a1", accountId: IDS.evaluators[0], hospitalId: IDS.hospitals[0], courseId: IDS.course },
    { id: "a2", accountId: IDS.evaluators[1], hospitalId: IDS.hospitals[1], courseId: IDS.course },
  ]);
  return { ...r, raw };
}

/** Adds a saved evaluation with section scores (tests only). */
export async function addEvaluation(
  r: Repo,
  e: { id: string; studentId: string; dateISO: string; attendance?: t.Attendance; scores: number[]; evaluatorId?: string; groupId?: string; hospitalId?: string; pending?: boolean }
) {
  const total = e.scores.reduce((a, b) => a + b, 0);
  await r.db.insert(t.evaluations).values({
    id: e.id, studentId: e.studentId, evaluatorId: e.evaluatorId ?? IDS.evaluators[0], dateISO: e.dateISO,
    attendance: e.attendance ?? "present", total, groupId: e.groupId ?? null, hospitalId: e.hospitalId ?? IDS.hospitals[0],
    pendingValidation: e.pending ?? false, courseId: IDS.course,
  });
  for (let i = 0; i < e.scores.length; i++) {
    await r.db.insert(t.evaluationScores).values({ id: `${e.id}-${i}`, evaluationId: e.id, rubricSectionId: `rs${i}`, score: e.scores[i] });
  }
}
