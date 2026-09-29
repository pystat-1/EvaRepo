import { prisma } from "../db";
import { listRubricSections } from "./rubric";
import { getGradingSheet } from "./gradingSheet";
import { getSheetsConfig, isSheetsConfigured, writeMatrix, appendRows } from "../integrations/googleSheets";

// Mirrors the grading center into a private Google Sheet. Two tabs:
//   - "الدرجات" (Grades): a matrix — one row PER STUDENT (name never
//     repeated), grades spread across columns grouped by hospital → week →
//     day, exactly like the paper sheet. Rewritten by "Sync all".
//   - "سجل اللقطات" (Capture Log): append-only, every save timestamped with
//     full per-criterion detail, so nothing is ever lost between syncs.
// Everything is a safe no-op when the integration isn't configured.

export { isSheetsConfigured };

const GRADES_TAB = "الدرجات";
const LOG_TAB = "سجل اللقطات";

const ATTENDANCE_LABEL: Record<string, string> = { present: "حاضر", late: "متأخر", absent: "غائب" };

export interface SyncResult {
  ok: boolean;
  configured: boolean;
  rows: number;
  error?: string;
}

// Section colors (light tints; dark text stays readable on them).
const COLOR = {
  legend: "#FFF2CC",
  studyType: "#B6D7A8",
  group: "#D0E8E0",
  hospital: "#CFE2F3",
  weekOdd: "#FCE5CD",
  weekEven: "#D9EAD3",
  day: "#EFEFEF",
};

// Consecutive runs of columns sharing a key (e.g. same hospital, or same
// hospital+week) — used to compute merge spans.
function spans<T>(items: T[], keyOf: (x: T) => string): { start: number; len: number }[] {
  const out: { start: number; len: number }[] = [];
  let i = 0;
  while (i < items.length) {
    const k = keyOf(items[i]);
    let j = i + 1;
    while (j < items.length && keyOf(items[j]) === k) j++;
    out.push({ start: i, len: j - i });
    i = j;
  }
  return out;
}

// Full rewrite of the Grades tab as a formatted matrix: study type → group
// sections, each student on ONE row, daily grades laid out across columns
// grouped and color-coded by hospital → week → day, with merged headers.
export async function syncAllToSheet(): Promise<SyncResult> {
  const cfg = getSheetsConfig();
  if (!cfg) return { ok: false, configured: false, rows: 0 };
  try {
    const { studyTypes, criteria, maxTotal } = await getGradingSheet({});

    const values: (string | number)[][] = [];
    const merges: [number, number, number, number][] = [];
    const bg: [number, number, number, number, string][] = [];
    const bold: [number, number, number, number][] = [];
    const fullWidthRows: number[] = []; // rows to merge across the whole grid at the end
    let width = 2;
    let studentRows = 0;
    const push = (r: (string | number)[]): number => values.push(r); // returns new length = 1-indexed row

    // Legend
    const legendRow = push([
      `ترتيب المعايير في كل خلية: ${criteria.map((c) => c.labelAr).join(" · ")} = المجموع (من ${maxTotal})  ·  غ = غائب  ·  فارغ = لا تقييم`,
    ]);
    bold.push([legendRow, 1, 1, 1]);
    bg.push([legendRow, 1, 1, 1, COLOR.legend]);
    fullWidthRows.push(legendRow);

    for (const st of studyTypes) {
      push([]); // spacer
      const stRow = push([`🧪 ${st.name}`]);
      bold.push([stRow, 1, 1, 1]);
      bg.push([stRow, 1, 1, 1, COLOR.studyType]);
      fullWidthRows.push(stRow);

      for (const g of st.groups) {
        const cols = g.columns;
        const w = 2 + cols.length;
        width = Math.max(width, w);

        const gRow = push([`المجموعة: ${g.name}${g.shiftLabel ? ` — ${g.shiftLabel}` : ""}${g.courseLabel ? ` — ${g.courseLabel}` : ""}`]);
        bold.push([gRow, 1, 1, 1]);
        bg.push([gRow, 1, 1, 1, COLOR.group]);
        merges.push([gRow, 1, 1, Math.max(1, w)]);

        if (cols.length > 0) {
          // Hospital header (merged per hospital run, blue)
          const hSpans = spans(cols, (c) => c.hospitalName);
          const hArr: (string | number)[] = ["", ""].concat(cols.map(() => ""));
          for (const sp of hSpans) hArr[2 + sp.start] = cols[sp.start].hospitalName;
          const hRow = push(hArr);
          for (const sp of hSpans) {
            if (sp.len > 1) merges.push([hRow, 3 + sp.start, 1, sp.len]);
            bg.push([hRow, 3 + sp.start, 1, sp.len, COLOR.hospital]);
          }
          bold.push([hRow, 3, 1, cols.length]);

          // Week header (merged per week run, alternating orange/green)
          const wSpans = spans(cols, (c) => `${c.hospitalName}|${c.weekIndex}`);
          const wArr: (string | number)[] = ["", ""].concat(cols.map(() => ""));
          for (const sp of wSpans) wArr[2 + sp.start] = `الأسبوع ${cols[sp.start].weekIndex}`;
          const wRow = push(wArr);
          for (const sp of wSpans) {
            if (sp.len > 1) merges.push([wRow, 3 + sp.start, 1, sp.len]);
            bg.push([wRow, 3 + sp.start, 1, sp.len, cols[sp.start].weekIndex % 2 ? COLOR.weekOdd : COLOR.weekEven]);
          }
          bold.push([wRow, 3, 1, cols.length]);

          // Day header
          const dArr: (string | number)[] = ["الطالب", "الرقم الجامعي"].concat(cols.map((c) => `اليوم ${c.dayIndex}\n${c.dateISO}`));
          const dRow = push(dArr);
          bg.push([dRow, 1, 1, w, COLOR.day]);
          bold.push([dRow, 1, 1, w]);
        } else {
          const dRow = push(["الطالب", "الرقم الجامعي"]);
          bg.push([dRow, 1, 1, 2, COLOR.day]);
          bold.push([dRow, 1, 1, 2]);
        }

        // Student rows — name appears exactly once; each day cell holds the
        // per-criterion detail "s1 · s2 · … = total".
        for (const s of g.students) {
          const row: (string | number)[] = [s.name, s.universityNumber];
          for (const cell of s.cells) {
            if (!cell) row.push("");
            else if (cell.attendance === "absent") row.push("غ");
            else row.push(`${criteria.map((c, i) => (cell.scores[i] == null ? "-" : cell.scores[i])).join(" · ")} = ${cell.total}`);
          }
          push(row);
          studentRows++;
        }
      }
    }

    for (const r of fullWidthRows) merges.push([r, 1, 1, width]);

    // Rectangular grid
    const padded = values.map((r) => {
      const c = r.slice();
      while (c.length < width) c.push("");
      return c;
    });

    await writeMatrix(cfg, GRADES_TAB, { values: padded, merges, bg, bold, freezeCols: 2 });
    return { ok: true, configured: true, rows: studentRows };
  } catch (e) {
    return { ok: false, configured: true, rows: 0, error: e instanceof Error ? e.message : "خطأ غير متوقع" };
  }
}

// Append one just-saved evaluation to the capture log. Fire-and-forget from
// the grade action: any failure is swallowed so it can never block a save.
export async function captureGradeToSheet(studentId: string, dateISO: string): Promise<void> {
  const cfg = getSheetsConfig();
  if (!cfg) return;
  try {
    const [e, sections] = await Promise.all([
      prisma.evaluation.findUnique({
        where: { studentId_dateISO: { studentId, dateISO } },
        include: {
          student: { include: { course: true, studyType: true, group: true } },
          evaluator: { select: { name: true } },
          scores: { select: { rubricSectionId: true, score: true } },
        },
      }),
      listRubricSections(),
    ]);
    // Not validated yet: captured when the evaluator validates the day.
    if (!e || e.pendingValidation) return;
    const hospital = e.hospitalId
      ? await prisma.hospital.findUnique({ where: { id: e.hospitalId }, select: { name: true } })
      : null;
    const byId = new Map(e.scores.map((s) => [s.rubricSectionId, s.score]));
    const capturedAt = new Date().toISOString();
    const row: (string | number)[] = [
      capturedAt,
      e.dateISO,
      e.student.nameAr,
      e.student.universityNumber,
      e.student.code ?? "",
      e.student.course ? e.student.course.label ?? `${e.student.course.year}-${e.student.course.number}` : "",
      e.student.studyType?.name ?? "",
      e.student.group?.name ?? "",
      hospital?.name ?? "",
      e.evaluator?.name ?? "",
      ATTENDANCE_LABEL[e.attendance] ?? e.attendance,
      ...sections.map((s) => byId.get(s.id) ?? ""),
      e.total,
      e.dailyNoteSubmitted ? "سُلِّمت" : "لم تُسلَّم",
      e.notes ?? "",
      e.feedback ?? "",
      e.locked ? "مقفل" : "مفتوح",
    ];
    await appendRows(cfg, LOG_TAB, [row]);
  } catch {
    // Backup is best-effort — never surface to the grading flow.
  }
}
