// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import { prisma } from "../db";
import { getMaxTotal } from "./rubric";

export interface Flag {
  id: string;
  studentId: string;
  ruleId: string;
  severity: "warning" | "danger";
  msg: string;
  dateISO: string;
  seen: boolean;
  createdAt: string;
}

function serialize(row: {
  id: string;
  studentId: string;
  ruleId: string;
  severity: string;
  msg: string;
  dateISO: string;
  seen: boolean;
  createdAt: Date;
}): Flag {
  return {
    id: row.id,
    studentId: row.studentId,
    ruleId: row.ruleId,
    severity: row.severity as Flag["severity"],
    msg: row.msg,
    dateISO: row.dateISO,
    seen: row.seen,
    createdAt: row.createdAt.toISOString(),
  };
}

// The three rules from the current app's flag engine (plan §5.1), kept as a
// small, documented, testable module rather than a client-side event-bus
// listener. Thresholds are tuned for the default 15-point rubric via a
// ratio of the current max total, so a future rubric-weight edit does not
// silently change what counts as "low."
const LOW_SCORE_RATIO = 0.6; // e.g. < 9/15 on the default rubric
const LOW_SCORE_MIN_COUNT = 2;
const ABSENCE_MIN_COUNT = 2;
const TREND_WINDOW = 5;
const TREND_SLOPE_THRESHOLD = -0.75;

async function upsertFlag(
  studentId: string,
  ruleId: string,
  severity: Flag["severity"],
  msg: string,
  dateISO: string
): Promise<void> {
  await prisma.flag.upsert({
    where: { studentId_ruleId: { studentId, ruleId } },
    create: { studentId, ruleId, severity, msg, dateISO },
    update: { severity, msg, dateISO },
  });
}

async function clearFlag(studentId: string, ruleId: string): Promise<void> {
  await prisma.flag.deleteMany({ where: { studentId, ruleId } });
}

function leastSquaresSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs = values.map((_, i) => i);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (values[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

// Runs on every evaluation save (see evaluations.ts) over just that
// student's own history — "seen" acknowledgements are preserved across
// recomputes because upsertFlag only touches severity/msg/date, never the
// seen flag, exactly as the current app's engine does.
export async function recomputeFlagsForStudent(studentId: string): Promise<void> {
  const evaluations = await prisma.evaluation.findMany({
    where: { studentId },
    orderBy: { dateISO: "asc" },
    select: { dateISO: true, attendance: true, total: true },
  });

  const maxTotal = await getMaxTotal();
  const lowScoreThreshold = maxTotal * LOW_SCORE_RATIO;

  const lowScoreCount = evaluations.filter((e: any) => e.total < lowScoreThreshold).length;
  if (lowScoreCount >= LOW_SCORE_MIN_COUNT) {
    await upsertFlag(
      studentId,
      "low_score",
      "warning",
      `${lowScoreCount} تقييمات بدرجة أقل من ${lowScoreThreshold.toFixed(1)}/${maxTotal}`,
      evaluations[evaluations.length - 1].dateISO
    );
  } else {
    await clearFlag(studentId, "low_score");
  }

  const absenceCount = evaluations.filter((e: any) => e.attendance === "absent").length;
  if (absenceCount >= ABSENCE_MIN_COUNT) {
    await upsertFlag(
      studentId,
      "attendance",
      "danger",
      `${absenceCount} حالات غياب مسجلة`,
      evaluations[evaluations.length - 1].dateISO
    );
  } else {
    await clearFlag(studentId, "attendance");
  }

  const recent = evaluations.slice(-TREND_WINDOW).map((e: any) => e.total);
  const slope = leastSquaresSlope(recent);
  if (recent.length >= 3 && slope <= TREND_SLOPE_THRESHOLD) {
    await upsertFlag(
      studentId,
      "declining_trend",
      "warning",
      `اتجاه تنازلي في الدرجات (ميل ${slope.toFixed(2)} خلال آخر ${recent.length} تقييمات)`,
      evaluations[evaluations.length - 1].dateISO
    );
  } else {
    await clearFlag(studentId, "declining_trend");
  }
}

export async function listFlagsForStudent(studentId: string): Promise<Flag[]> {
  const rows = await prisma.flag.findMany({ where: { studentId }, orderBy: { createdAt: "desc" } });
  return rows.map(serialize);
}

export interface FlagWithStudent extends Flag {
  studentNameAr: string;
  universityNumber: string;
}

export async function listAllFlags(unseenOnly = false): Promise<FlagWithStudent[]> {
  const rows = await prisma.flag.findMany({
    where: unseenOnly ? { seen: false } : undefined,
    orderBy: { createdAt: "desc" },
    include: { student: { select: { nameAr: true, universityNumber: true } } },
  });
  return rows.map((r: any) => ({
    ...serialize(r),
    studentNameAr: r.student.nameAr,
    universityNumber: r.student.universityNumber,
  }));
}

export async function countUnseenFlags(): Promise<number> {
  return prisma.flag.count({ where: { seen: false } });
}

export async function markFlagSeen(id: string): Promise<void> {
  await prisma.flag.update({ where: { id }, data: { seen: true } });
}
