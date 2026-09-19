import { prisma } from "../db";
import { recordAudit } from "../audit";
import { getTermSettings } from "./termSettings";

// The course-setup automation engine: from the term settings (weeks, days,
// weekday pattern, start date) plus the active hospitals and groups, it
// generates the whole rotation schedule in one shot — every group cycled
// through the hospitals, week by week, with real dates and the term's
// attendance days. Evaluators assigned to a hospital automatically cover
// whichever group is rotating there on any given day, so a single "generate"
// wires the entire evaluator experience.
//
// Design goals the caller relies on:
//  - It NEVER throws for expected conditions (missing prerequisites, no
//    hospitals/groups). It returns a structured result with human-readable
//    errors/warnings, so the UI can't crash on it.
//  - It is IDEMPOTENT: it only ever touches blocks it created itself
//    (tagged AUTO_TAG). Re-running regenerates cleanly; any manually-added
//    blocks are left untouched. Saved evaluations are never deleted
//    (they key on student+date, not on a rotation block).

const AUTO_TAG = "[auto]";

export interface GenerateSummaryRow {
  groupName: string;
  segments: { hospitalName: string; startDate: string; endDate: string }[];
}

export interface GenerateResult {
  ok: boolean;
  created: number;
  clearedAuto: number;
  errors: string[];
  warnings: string[];
  summary: GenerateSummaryRow[];
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isValidISO(iso: string | null | undefined): iso is string {
  return !!iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) && !isNaN(new Date(`${iso}T00:00:00Z`).getTime());
}

export async function generateRotationSchedule(actorId: string): Promise<GenerateResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const empty: GenerateResult = { ok: false, created: 0, clearedAuto: 0, errors, warnings, summary: [] };

  try {
    const [term, hospitals, groups] = await Promise.all([
      getTermSettings(),
      prisma.hospital.findMany({ where: { active: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
      prisma.group.findMany({
        where: { active: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      }),
    ]);

    // ---- Validate prerequisites (each a clear, actionable message) ----
    if (!isValidISO(term.startDate)) errors.push("حدّد تاريخ بداية الفصل في خطوة «عدد الأسابيع».");
    if (!term.weeksCount || term.weeksCount < 1) errors.push("حدّد عدد الأسابيع (١ فأكثر) في خطوة «عدد الأسابيع».");
    if (!term.weekdays || term.weekdays.split(",").filter(Boolean).length === 0)
      errors.push("اختر أيام الحضور الأسبوعية في خطوة «أيام الأسبوع».");
    if (hospitals.length === 0) errors.push("أضف مستشفى واحداً على الأقل قبل توليد الجدول.");
    if (groups.length === 0) errors.push("أضف مجموعة واحدة على الأقل قبل توليد الجدول.");
    if (errors.length > 0) return empty;

    const totalWeeks = term.weeksCount!;
    const weekdays = term.weekdays!;
    const start = term.startDate!;
    const h = hospitals.length;

    // Weeks each group spends at one hospital before moving on. Chosen so a
    // group rotates through as many hospitals as the term allows.
    const weeksPerHospital = Math.max(1, Math.floor(totalWeeks / h));
    if (totalWeeks < h) {
      warnings.push(
        `عدد الأسابيع (${totalWeeks}) أقل من عدد المستشفيات (${h}) — لن تمرّ كل مجموعة على كل المستشفيات هذا الفصل.`
      );
    }

    // ---- Build the blocks (nothing written yet) ----
    const blocksData: {
      groupId: string;
      hospitalId: string;
      startDate: string;
      endDate: string;
      daysOfWeek: string;
      notes: string;
    }[] = [];
    const summary: GenerateSummaryRow[] = [];

    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const segments: GenerateSummaryRow["segments"] = [];
      let startWeek = 0;
      let seg = 0;
      while (startWeek < totalWeeks) {
        const endWeek = Math.min(startWeek + weeksPerHospital, totalWeeks);
        // Offset each group's starting hospital so groups are spread across
        // hospitals instead of all crowding the first one.
        const hospital = hospitals[(gi + seg) % h];
        const startDate = addDaysISO(start, startWeek * 7);
        const endDate = addDaysISO(start, endWeek * 7 - 1);
        blocksData.push({
          groupId: g.id,
          hospitalId: hospital.id,
          startDate,
          endDate,
          daysOfWeek: weekdays,
          notes: AUTO_TAG,
        });
        segments.push({ hospitalName: hospital.name, startDate, endDate });
        startWeek = endWeek;
        seg++;
      }
      summary.push({ groupName: g.name, segments });
    }

    // ---- Commit: replace only our own auto blocks, atomically ----
    const { clearedAuto } = await prisma.$transaction(async (tx) => {
      const cleared = await tx.rotationBlock.deleteMany({ where: { notes: AUTO_TAG } });
      if (blocksData.length > 0) await tx.rotationBlock.createMany({ data: blocksData });
      return { clearedAuto: cleared.count };
    });

    await recordAudit({
      actorId,
      entityType: "RotationBlock",
      entityId: "auto-generate",
      action: "create",
      after: { created: blocksData.length, clearedAuto, weeksPerHospital, groups: groups.length, hospitals: h },
    });

    return { ok: true, created: blocksData.length, clearedAuto, errors, warnings, summary };
  } catch (e) {
    // Anything unexpected is reported, never thrown — the setup screen must
    // not crash on a generation attempt.
    errors.push(e instanceof Error ? e.message : "حدث خطأ غير متوقع أثناء توليد الجدول.");
    return empty;
  }
}

// Removes only the engine-generated blocks (leaves manual ones), for a clean
// "clear auto schedule" action.
export async function clearAutoRotationSchedule(actorId: string): Promise<{ cleared: number }> {
  try {
    const res = await prisma.rotationBlock.deleteMany({ where: { notes: AUTO_TAG } });
    await recordAudit({ actorId, entityType: "RotationBlock", entityId: "auto-clear", action: "delete", after: { cleared: res.count } });
    return { cleared: res.count };
  } catch {
    return { cleared: 0 };
  }
}
