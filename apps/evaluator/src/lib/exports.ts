// Files the evaluator can download from the phone, made on the phone (they
// work offline): a day's grades or a blank template to print (Excel and
// Word), the whole schedule, the attendance log, previous assessments and
// the students' records (Excel). The libraries load only when needed.
import type { EvaluatorBundle, HistoryRecord } from "@eva/core/sync/contract";
import { gradeColumns, maxTotal } from "./day";
import { ATTENDANCE_AR, ATTENDANCE_MARK, SHIFT_AR, STATE_AR, weekdayAr, type DayEntry, type ScheduleStint, type StudentSummary } from "./views";

type Workbook = import("exceljs").Workbook;
type Worksheet = import("exceljs").Worksheet;

const BRAND = "FF0E5C6B";
const MARK_AR: Record<string, string> = { done: "قيّمته", colleague: "قيّمه زميل", draft: "مسودة", missed: "لم يُقيَّم", today: "اليوم", future: "قادم" };

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").trim();
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "" : Math.round(n * 100) / 100);

async function workbook(): Promise<Workbook> {
  const mod = await import("exceljs");
  const Excel = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new Excel.Workbook();
  wb.creator = "Eva";
  return wb;
}

async function saveWorkbook(wb: Workbook, name: string) {
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${safe(name)}.xlsx`);
}

function sheet(wb: Workbook, name: string, title: string[], header: string[], widths: number[]): Worksheet {
  const ws = wb.addWorksheet(safe(name).slice(0, 31), { views: [{ rightToLeft: true, state: "frozen", ySplit: title.length + 1, xSplit: 0 }] });
  title.forEach((t, i) => {
    const row = ws.addRow([t]);
    row.font = i === 0 ? { bold: true, size: 14, color: { argb: BRAND } } : { size: 11 };
  });
  const h = ws.addRow(header);
  h.height = 30;
  h.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  });
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  return ws;
}

function boxRow(ws: Worksheet, values: unknown[], shade = false) {
  const row = ws.addRow(values);
  row.eachCell({ includeEmpty: true }, (c, n) => {
    if (n > values.length) return;
    c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
    c.alignment = { vertical: "middle", horizontal: n <= 3 ? "right" : "center" };
    if (shade) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6E5E3" } };
  });
  return row;
}

// ---- a day's grades (or the blank template) ------------------------------------

export interface DayMeta {
  groupId: string;
  dateISO: string;
  hospitalName: string;
  evaluatorName: string;
}

function dayTitle(bundle: EvaluatorBundle, m: DayMeta, blank: boolean) {
  const g = bundle.groups.find((x) => x.id === m.groupId)!;
  return {
    g,
    title: blank ? "قالب درجات اليوم" : "درجات اليوم",
    lines: [
      `${bundle.course.label} · ${g.name}${g.shift ? ` (${SHIFT_AR[g.shift]})` : ""} · ${m.hospitalName}`,
      `${weekdayAr(m.dateISO)} ${m.dateISO} · المقيّم: ${m.evaluatorName}`,
    ],
  };
}

/** Excel: one row per student, every criterion, section totals and the total. `records` null = blank template. */
export async function dayExcel(bundle: EvaluatorBundle, m: DayMeta, records: Map<string, HistoryRecord> | null) {
  const blank = !records;
  const { g, title, lines } = dayTitle(bundle, m, blank);
  const cols = gradeColumns(bundle);
  const sections = bundle.rubric.filter((s) => s.items.length);
  const isSection = new Set(bundle.rubric.map((s) => s.id));
  const header = [
    "#", "الرقم الجامعي", "اسم الطالب", "الحضور", "الديلي نوت",
    ...cols.map((c) => `${c.label === c.section ? c.section : `${c.section}: ${c.label}`} (${c.max})`),
    ...(blank ? [] : sections.map((s) => `مجموع ${s.labelAr} (${s.maxScore})`)),
    `المجموع (${maxTotal(bundle)})`, "ملاحظات",
  ];
  const wb = await workbook();
  const ws = sheet(wb, `${g.name} ${m.dateISO}`, [title, ...lines], header, [5, 15, 26, 10, 11, ...cols.map(() => 11), ...(blank ? [] : sections.map(() => 12)), 11, 24]);
  g.students.forEach((s, i) => {
    const r = records?.get(s.id);
    const values = [
      i + 1, s.universityNumber, s.name,
      r ? ATTENDANCE_AR[r.attendance] : "",
      r ? (r.attendance === "absent" ? "—" : r.dailyNote === true ? "سلّم" : r.dailyNote === false ? "لم يسلّم" : "") : "",
      // older website grades have section totals only: item cells stay empty
      ...cols.map((c) => (!r || r.attendance === "absent" ? "" : isSection.has(c.id) ? fmt(r.items?.[c.id] ?? r.sections[c.id]) : r.items ? fmt(r.items[c.id]) : "")),
      ...(blank ? [] : sections.map((sec) => (r && r.attendance !== "absent" ? fmt(r.sections[sec.id]) : ""))),
      r ? fmt(r.total) : "",
      r?.notes ?? "",
    ];
    boxRow(ws, values, r?.attendance === "absent");
  });
  if (blank) {
    const first = lines.length + 3;
    const last = first + g.students.length - 1;
    for (let n = first; n <= last; n++) {
      ws.getCell(n, 4).dataValidation = { type: "list", allowBlank: true, formulae: ['"حاضر,متأخر,غائب"'] };
      ws.getCell(n, 5).dataValidation = { type: "list", allowBlank: true, formulae: ['"سلّم,لم يسلّم"'] };
    }
  }
  ws.addRow([]);
  ws.addRow(["", "", "توقيع المقيّم: ........................", "", "", "", "التاريخ: ................"]);
  ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  await saveWorkbook(wb, `${title} ${g.name} ${m.dateISO}`);
}

/** Word: a printable table (landscape A4). Filled: section totals. Blank: every criterion to fill in by hand. */
export async function dayWord(bundle: EvaluatorBundle, m: DayMeta, records: Map<string, HistoryRecord> | null) {
  const d = await import("docx");
  const blank = !records;
  const { g, title, lines } = dayTitle(bundle, m, blank);
  const cols = blank
    ? gradeColumns(bundle).map((c) => ({ id: c.id, label: c.label === c.section ? c.section : c.label, max: c.max }))
    : bundle.rubric.map((s) => ({ id: s.id, label: s.labelAr, max: s.maxScore }));
  const size = blank ? 14 : 18; // half-points
  const text = (t: string, bold = false, sz = size) =>
    new d.Paragraph({ bidirectional: true, alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: t, bold, size: sz, rightToLeft: true, font: "Arial" })] });
  const cell = (t: string, o: { bold?: boolean; fill?: string; start?: boolean } = {}) =>
    new d.TableCell({
      children: [o.start ? new d.Paragraph({ bidirectional: true, children: [new d.TextRun({ text: t, bold: o.bold, size, rightToLeft: true, font: "Arial" })] }) : text(t, o.bold)],
      shading: o.fill ? { type: d.ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
      verticalAlign: d.VerticalAlign.CENTER,
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
    });
  const head = new d.TableRow({
    tableHeader: true,
    children: ["#", "اسم الطالب", "الحضور", "الديلي نوت", ...cols.map((c) => `${c.label} (${c.max})`), `المجموع (${maxTotal(bundle)})`, ...(blank ? ["ملاحظات"] : [])].map(
      (t) => cell(t, { bold: true, fill: "DCEBEA" })
    ),
  });
  const body = g.students.map((s, i) => {
    const r = records?.get(s.id);
    const absent = r?.attendance === "absent";
    const values = [
      String(i + 1),
      s.name,
      r ? ATTENDANCE_AR[r.attendance] : "",
      r ? (absent ? "—" : r.dailyNote === true ? "سلّم" : r.dailyNote === false ? "لم يسلّم" : "") : "",
      ...cols.map((c) => (r && !absent ? String(fmt(r.sections[c.id]) ?? "") : "")),
      r ? String(fmt(r.total)) : "",
      ...(blank ? [""] : []),
    ];
    return new d.TableRow({ children: values.map((v, n) => cell(v, { start: n === 1, fill: absent ? "F6E5E3" : undefined })) });
  });
  const doc = new d.Document({
    creator: "Eva",
    title: `${title} ${g.name} ${m.dateISO}`,
    sections: [
      {
        properties: { page: { size: { orientation: d.PageOrientation.LANDSCAPE }, margin: { top: 567, bottom: 567, left: 567, right: 567 } } },
        children: [
          text(title, true, 32),
          ...lines.map((l) => text(l, false, 22)),
          new d.Paragraph({ children: [] }),
          new d.Table({ visuallyRightToLeft: true, width: { size: 100, type: d.WidthType.PERCENTAGE }, rows: [head, ...body] }),
          new d.Paragraph({ children: [] }),
          text("توقيع المقيّم: ..............................          التاريخ: ....................", false, 22),
        ],
      },
    ],
  });
  downloadBlob(await d.Packer.toBlob(doc), `${safe(`${title} ${g.name} ${m.dateISO}`)}.docx`);
}

// ---- whole-course files ---------------------------------------------------------

export async function scheduleExcel(bundle: EvaluatorBundle, hospitals: Array<{ hospitalName: string; stints: ScheduleStint[] }>) {
  const wb = await workbook();
  const ws = sheet(
    wb,
    "الجدول",
    [`جدولي — ${bundle.course.label}`, `المقيّم: ${bundle.evaluator.name}`],
    ["المستشفى", "المجموعة", "الدوام", "من", "إلى", "عدد الطلاب", "اليوم", "التاريخ", "الحالة"],
    [22, 24, 10, 12, 12, 11, 11, 12, 14]
  );
  for (const h of hospitals)
    for (const s of h.stints)
      for (const w of s.weeks)
        for (const day of w)
          boxRow(ws, [h.hospitalName, s.groupName, s.shift ? SHIFT_AR[s.shift] : "", s.startDate, s.endDate, s.studentCount, day.weekday, day.dateISO, MARK_AR[day.mark]]);
  await saveWorkbook(wb, `جدولي ${bundle.course.label}`);
}

export async function attendanceExcel(bundle: EvaluatorBundle, groupId: string, entries: DayEntry[]) {
  const g = bundle.groups.find((x) => x.id === groupId)!;
  const days = entries.filter((e) => e.groupId === groupId).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const wb = await workbook();
  const ws = sheet(
    wb,
    `سجل الحضور ${g.name}`,
    [`سجل الحضور — ${g.name}`, `${bundle.course.label} · ✓ حاضر · م متأخر · ✗ غائب · (ن) سلّم الديلي نوت`],
    ["#", "الرقم الجامعي", "اسم الطالب", ...days.map((d) => `${weekdayAr(d.dateISO)}\n${d.dateISO}`), "حاضر", "متأخر", "غائب", "الديلي نوت"],
    [5, 15, 26, ...days.map(() => 11), 8, 8, 8, 10]
  );
  g.students.forEach((s, i) => {
    const marks = days.map((d) => {
      const r = d.records.get(s.id);
      return r ? `${ATTENDANCE_MARK[r.attendance]}${r.dailyNote ? " (ن)" : ""}` : "";
    });
    const recs = days.map((d) => d.records.get(s.id)).filter((x): x is HistoryRecord => !!x);
    boxRow(ws, [i + 1, s.universityNumber, s.name, ...marks, ...(["present", "late", "absent"] as const).map((a) => recs.filter((r) => r.attendance === a).length), recs.filter((r) => r.dailyNote).length]);
  });
  await saveWorkbook(wb, `سجل الحضور ${g.name}`);
}

export async function historyExcel(bundle: EvaluatorBundle, entries: DayEntry[]) {
  const wb = await workbook();
  const ws = sheet(
    wb,
    "التقييمات السابقة",
    [`التقييمات السابقة — ${bundle.evaluator.name}`, bundle.course.label],
    ["التاريخ", "المستشفى", "المجموعة", "الرقم الجامعي", "اسم الطالب", "الحضور", "الديلي نوت", ...bundle.rubric.map((s) => `${s.labelAr} (${s.maxScore})`), `المجموع (${maxTotal(bundle)})`, "الحالة"],
    [12, 20, 22, 15, 26, 10, 11, ...bundle.rubric.map(() => 12), 11, 20]
  );
  for (const e of entries) {
    const g = bundle.groups.find((x) => x.id === e.groupId);
    for (const s of g?.students ?? []) {
      const r = e.records.get(s.id);
      if (!r) continue;
      const absent = r.attendance === "absent";
      boxRow(ws, [e.dateISO, e.hospitalName, g!.name, s.universityNumber, s.name, ATTENDANCE_AR[r.attendance], absent ? "—" : r.dailyNote ? "سلّم" : "لم يسلّم", ...bundle.rubric.map((sec) => (absent ? "" : fmt(r.sections[sec.id]))), fmt(r.total), STATE_AR[e.state]], absent);
    }
  }
  await saveWorkbook(wb, `التقييمات السابقة ${bundle.evaluator.name}`);
}

export async function studentsExcel(bundle: EvaluatorBundle, students: StudentSummary[]) {
  const wb = await workbook();
  const ws = sheet(
    wb,
    "طلابي",
    [`طلابي — ${bundle.course.label}`, `المقيّم: ${bundle.evaluator.name}`],
    ["الرقم الجامعي", "اسم الطالب", "المجموعة", "أيام مقيَّمة", "حاضر", "متأخر", "غائب", "الديلي نوت", `المعدل (${maxTotal(bundle)})`],
    [15, 26, 22, 11, 8, 8, 8, 10, 12]
  );
  for (const s of students) boxRow(ws, [s.universityNumber, s.name, s.groupName, s.days.length, s.present, s.late, s.absent, s.notes, fmt(s.average)]);
  await saveWorkbook(wb, `طلابي ${bundle.course.label}`);
}
