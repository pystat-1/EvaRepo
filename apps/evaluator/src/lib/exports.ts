// Files the evaluator can download from the phone, made on the phone (they
// work offline): a day's grades or a blank template to print (Excel and
// Word), the whole schedule, the attendance log, previous assessments and
// the students' records (Excel). The libraries load only when needed.
import type { EvaluatorBundle, HistoryRecord } from "@eva/core/sync/contract";
import { maxTotal } from "./day";
import { ATTENDANCE_AR, SHIFT_AR, STATE_AR, weekdayAr, type DayEntry, type ScheduleStint, type StudentSummary } from "./views";

type Workbook = import("exceljs").Workbook;
type Worksheet = import("exceljs").Worksheet;

const BRAND = "FF0E5C6B";
const MARK_AR: Record<string, string> = { done: "قيّمته", colleague: "قيّمه زميل", draft: "مسودة", missed: "لم يُقيَّم", today: "اليوم", future: "قادم", holiday: "عطلة" };

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

// The layout of the college's paper form "Daily Evaluation of Hospital
// Practice", read right to left: No. | Student Name | Hospital Name |
// (Attendance, which the form lacks but Eva records) | each criterion group
// with its items | Total | Assessment. Three header rows like the form:
// group (max), item max, item name (English as on the form, Arabic below).
interface FormColumn {
  id: string;
  section: string; // "Appearance (1)\nالمظهر"
  sectionId: string;
  firstOfSection: boolean;
  span: number; // items in the section (on the first column only)
  max: number;
  name: string; // "Badge\nالشارة"
  isSectionOnly: boolean; // a section without items: its own score
}

function formColumns(bundle: EvaluatorBundle): FormColumn[] {
  return bundle.rubric.flatMap((s) => {
    const section = `${s.labelEn ?? s.labelAr} (${s.maxScore})\n${s.labelAr}`;
    const items = s.items.length ? s.items : [{ id: s.id, labelAr: s.labelAr, labelEn: s.labelEn, maxScore: s.maxScore }];
    return items.map((i, n) => ({
      id: i.id,
      section,
      sectionId: s.id,
      firstOfSection: n === 0,
      span: items.length,
      max: i.maxScore,
      name: i.labelEn && i.labelEn !== s.labelEn ? `${i.labelEn}\n${i.labelAr}` : i.labelAr === s.labelAr ? "" : i.labelAr,
      isSectionOnly: !s.items.length,
    }));
  });
}

const FORM_TITLE = "Daily Evaluation of Hospital Practice";
const FORM_TITLE_AR = "التقييم اليومي للممارسة في المستشفى";

function dayTitle(bundle: EvaluatorBundle, m: DayMeta, blank: boolean) {
  const g = bundle.groups.find((x) => x.id === m.groupId)!;
  return {
    g,
    fileTitle: blank ? "قالب التقييم اليومي" : "التقييم اليومي",
    lines: [
      `${bundle.course.label} · ${g.name}${g.shift ? ` (${SHIFT_AR[g.shift]})` : ""} · ${m.hospitalName}`,
      `${weekdayAr(m.dateISO)} ${m.dateISO} · المقيّم: ${m.evaluatorName}`,
    ],
  };
}

/** One student's value in a form column ("" when not graded, absent, or graded by section only). */
function cellValue(c: FormColumn, r: HistoryRecord | undefined): string | number {
  if (!r || r.attendance === "absent") return "";
  if (c.isSectionOnly) return fmt(r.items?.[c.id] ?? r.sections[c.sectionId]);
  return r.items ? fmt(r.items[c.id] ?? 0) : ""; // older website grades: section totals only
}

const attendanceText = (r: HistoryRecord | undefined) => (r ? ATTENDANCE_AR[r.attendance] : "");
const assessmentText = (r: HistoryRecord | undefined) =>
  !r ? "" : [r.attendance !== "absent" && r.dailyNote === false ? "لم يسلّم الديلي نوت" : "", r.notes ?? ""].filter(Boolean).join(" — ");

/** Excel in the form's layout. `records` null = the blank template to print or fill. */
export async function dayExcel(bundle: EvaluatorBundle, m: DayMeta, records: Map<string, HistoryRecord> | null) {
  const blank = !records;
  const { g, fileTitle, lines } = dayTitle(bundle, m, blank);
  const cols = formColumns(bundle);
  const total = maxTotal(bundle);
  const fixedStart = ["No.\nت", "Student Name\nاسم الطالب", "Hospital Name\nالمستشفى", "Attendance\nالحضور"];
  const fixedEnd = [`Total (${total})\nالمجموع`, "Assessment\nالتقدير"];
  const width = fixedStart.length + cols.length + fixedEnd.length;
  const wb = await workbook();
  const ws = wb.addWorksheet(safe(`${g.name} ${m.dateISO}`).slice(0, 31), { views: [{ rightToLeft: true, state: "frozen", ySplit: 6, xSplit: 2 }] });
  ws.mergeCells(1, 1, 1, width);
  ws.getCell(1, 1).value = `${FORM_TITLE} — ${FORM_TITLE_AR}`;
  ws.getCell(1, 1).font = { bold: true, size: 15, underline: true };
  ws.getCell(1, 1).alignment = { horizontal: "center" };
  lines.forEach((l, i) => {
    ws.mergeCells(2 + i, 1, 2 + i, width);
    ws.getCell(2 + i, 1).value = l;
    ws.getCell(2 + i, 1).alignment = { horizontal: "center" };
  });
  // header rows 4 (group), 5 (item max), 6 (item name)
  const H1 = 4, H2 = 5, H3 = 6;
  const head = (row: number, col: number, text: string | number, rotate = false) => {
    const c = ws.getCell(row, col);
    c.value = text;
    c.font = { bold: true, size: 10 };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true, ...(rotate ? { textRotation: 90 } : {}) };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCEBEA" } };
  };
  fixedStart.forEach((t, i) => {
    ws.mergeCells(H1, i + 1, H3, i + 1);
    head(H1, i + 1, t);
  });
  cols.forEach((c, i) => {
    const col = fixedStart.length + 1 + i;
    if (c.firstOfSection) {
      if (c.span > 1) ws.mergeCells(H1, col, H1, col + c.span - 1);
      head(H1, col, c.section);
    }
    head(H2, col, c.max);
    head(H3, col, c.name, true);
  });
  fixedEnd.forEach((t, i) => {
    const col = fixedStart.length + cols.length + 1 + i;
    ws.mergeCells(H1, col, H3, col);
    head(H1, col, t);
  });
  ws.getRow(H1).height = 34;
  ws.getRow(H3).height = 92;
  g.students.forEach((s, i) => {
    const r = records?.get(s.id);
    const row = ws.addRow([i + 1, s.name, m.hospitalName, attendanceText(r), ...cols.map((c) => cellValue(c, r)), r ? fmt(r.total) : "", assessmentText(r)]);
    row.eachCell({ includeEmpty: true }, (cell, n) => {
      if (n > width) return;
      cell.alignment = { vertical: "middle", horizontal: n === 2 || n === 3 || n === width ? "right" : "center", wrapText: n === width };
      if (r?.attendance === "absent") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6E5E3" } };
    });
    if (blank) ws.getCell(row.number, 4).dataValidation = { type: "list", allowBlank: true, formulae: ['"حاضر,متأخر,غائب"'] };
  });
  const last = ws.rowCount;
  for (let rr = H1; rr <= last; rr++)
    for (let cc = 1; cc <= width; cc++) ws.getCell(rr, cc).border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  [5, 26, 20, 10, ...cols.map(() => 6.5), 9, 22].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.addRow([]);
  ws.addRow(["", "توقيع المقيّم: ........................", "", "", "", "", "", "", "التاريخ: ................"]);
  ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${H1}:${H3}` };
  await saveWorkbook(wb, `${fileTitle} ${g.name} ${m.dateISO}`);
}

/** Word in the form's layout (landscape A4). `records` null = the blank template to print. */
export async function dayWord(bundle: EvaluatorBundle, m: DayMeta, records: Map<string, HistoryRecord> | null) {
  const d = await import("docx");
  const blank = !records;
  const { g, fileTitle, lines } = dayTitle(bundle, m, blank);
  const cols = formColumns(bundle);
  const total = maxTotal(bundle);
  const size = 15; // half-points
  const para = (t: string, o: { bold?: boolean; sz?: number; start?: boolean } = {}) =>
    t.split("\n").map(
      (line) =>
        new d.Paragraph({
          bidirectional: true,
          alignment: o.start ? d.AlignmentType.START : d.AlignmentType.CENTER,
          spacing: { before: 0, after: 0 },
          children: [new d.TextRun({ text: line, bold: o.bold, size: o.sz ?? size, rightToLeft: true, font: "Arial" })],
        })
    );
  const shade = { type: d.ShadingType.CLEAR, color: "auto", fill: "DCEBEA" };
  const cell = (t: string, o: { bold?: boolean; fill?: boolean; rowSpan?: number; columnSpan?: number; start?: boolean; vertical?: boolean; absent?: boolean } = {}) =>
    new d.TableCell({
      children: para(t, { bold: o.bold, start: o.start }),
      rowSpan: o.rowSpan,
      columnSpan: o.columnSpan,
      shading: o.fill ? shade : o.absent ? { type: d.ShadingType.CLEAR, color: "auto", fill: "F6E5E3" } : undefined,
      verticalAlign: d.VerticalAlign.CENTER,
      textDirection: o.vertical ? d.TextDirection.BOTTOM_TO_TOP_LEFT_TO_RIGHT : undefined,
      margins: { top: 30, bottom: 30, left: 30, right: 30 },
    });
  const fixedStart = ["No.\nت", "Student Name\nاسم الطالب", "Hospital Name\nالمستشفى", "Attendance\nالحضور"];
  const fixedEnd = [`Total (${total})\nالمجموع`, "Assessment\nالتقدير"];
  const row1 = new d.TableRow({
    tableHeader: true,
    children: [
      ...fixedStart.map((t) => cell(t, { bold: true, fill: true, rowSpan: 3 })),
      ...cols.filter((c) => c.firstOfSection).map((c) => cell(c.section, { bold: true, fill: true, columnSpan: c.span })),
      ...fixedEnd.map((t) => cell(t, { bold: true, fill: true, rowSpan: 3 })),
    ],
  });
  const row2 = new d.TableRow({ tableHeader: true, children: cols.map((c) => cell(String(c.max), { bold: true, fill: true })) });
  const row3 = new d.TableRow({
    tableHeader: true,
    height: { value: 1300, rule: d.HeightRule.ATLEAST },
    children: cols.map((c) => cell(c.name.replace("\n", " / "), { fill: true, vertical: true })),
  });
  const body = g.students.map((s, i) => {
    const r = records?.get(s.id);
    const absent = r?.attendance === "absent";
    const values = [String(i + 1), s.name, m.hospitalName, attendanceText(r), ...cols.map((c) => String(cellValue(c, r))), r ? String(fmt(r.total)) : "", assessmentText(r)];
    return new d.TableRow({ children: values.map((v, n) => cell(v, { start: n === 1 || n === 2 || n === values.length - 1, absent })) });
  });
  const doc = new d.Document({
    creator: "Eva",
    title: `${fileTitle} ${g.name} ${m.dateISO}`,
    sections: [
      {
        properties: { page: { size: { orientation: d.PageOrientation.LANDSCAPE }, margin: { top: 500, bottom: 500, left: 500, right: 500 } } },
        children: [
          new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: FORM_TITLE, bold: true, underline: {}, size: 28, font: "Times New Roman" })] }),
          ...para(FORM_TITLE_AR, { bold: true, sz: 24 }),
          ...lines.flatMap((l) => para(l, { sz: 20 })),
          new d.Paragraph({ children: [] }),
          new d.Table({ visuallyRightToLeft: true, width: { size: 100, type: d.WidthType.PERCENTAGE }, rows: [row1, row2, row3, ...body] }),
          new d.Paragraph({ children: [] }),
          ...para("توقيع المقيّم: ..............................          التاريخ: ....................", { sz: 20 }),
        ],
      },
    ],
  });
  downloadBlob(await d.Packer.toBlob(doc), `${safe(`${fileTitle} ${g.name} ${m.dateISO}`)}.docx`);
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
          boxRow(ws, [h.hospitalName, s.groupName, s.shift ? SHIFT_AR[s.shift] : "", s.startDate, s.endDate, s.studentCount, day.weekday, day.dateISO, day.note ? `${MARK_AR[day.mark]} · ${day.note}` : MARK_AR[day.mark]]);
  await saveWorkbook(wb, `جدولي ${bundle.course.label}`);
}

export async function attendanceExcel(bundle: EvaluatorBundle, groupId: string, entries: DayEntry[]) {
  const g = bundle.groups.find((x) => x.id === groupId)!;
  const days = entries.filter((e) => e.groupId === groupId).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const wb = await workbook();
  // Plain: the student's name and, for each day, حاضر / متأخر / غائب.
  const ws = sheet(
    wb,
    `سجل الحضور ${g.name}`,
    [`سجل الحضور — ${g.name}`, bundle.course.label],
    ["#", "اسم الطالب", ...days.map((d) => `${weekdayAr(d.dateISO)}\n${d.dateISO}`)],
    [5, 28, ...days.map(() => 12)]
  );
  const FILL = { late: "FFF6ECD6", absent: "FFF6E5E3" } as const;
  g.students.forEach((s, i) => {
    const recs = days.map((d) => d.records.get(s.id));
    const row = boxRow(ws, [i + 1, s.name, ...recs.map((r) => (r ? ATTENDANCE_AR[r.attendance] : ""))]);
    recs.forEach((r, n) => {
      row.getCell(3 + n).alignment = { vertical: "middle", horizontal: "center" };
      if (r && r.attendance !== "present") row.getCell(3 + n).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[r.attendance] } };
    });
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
