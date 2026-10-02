// The student Excel template (قالب الطلاب): building it and reading a filled
// one. Shared by the website and the desktop app. The ExcelJS module is
// passed in, so this package keeps no dependencies of its own.
import { TEMPLATE_COLUMNS, headerKey, type StudentRowInput, type TemplateKey } from "./importRows";

/* Minimal slice of the ExcelJS API used here. */
type Cell = { text?: string; value?: unknown; font?: unknown; fill?: unknown; alignment?: unknown; dataValidation?: unknown };
type Row = { height?: number; eachCell(cb: (cell: Cell, col: number) => void): void; getCell(col: number): Cell };
type Sheet = {
  name: string;
  columns: unknown;
  views?: unknown;
  getRow(n: number): Row;
  getColumn(key: string | number): { width?: number; numFmt?: string };
  getCell(addr: string): Cell;
  addRow(values: unknown): Row;
  eachRow(opts: { includeEmpty: boolean }, cb: (row: Row, n: number) => void): void;
};
type Workbook = {
  creator?: string;
  worksheets: Sheet[];
  addWorksheet(name: string, opts?: unknown): Sheet;
  xlsx: { load(data: ArrayBuffer): Promise<unknown>; writeBuffer(): Promise<ArrayBuffer | Uint8Array> };
};
export interface ExcelLib {
  Workbook: new () => unknown;
}

export interface TemplateContext {
  courseLabel: string;
  studyTypeName: string;
  groups: Array<{ shift: "MORNING" | "EVENING"; number: number; name: string }>;
}

const SHIFT_AR = { MORNING: "صباحي", EVENING: "مسائي" } as const;

/** Builds the template (optionally pre-filled) and returns the .xlsx bytes. */
export async function buildStudentTemplate(
  Excel: ExcelLib,
  ctx: TemplateContext,
  data: Array<Record<TemplateKey, string>> = []
): Promise<Uint8Array> {
  const wb = new Excel.Workbook() as Workbook;
  wb.creator = "Eva";
  const ws = wb.addWorksheet("الطلاب", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c.header + (c.required ? " *" : ""), key: c.key, width: c.width }));
  const header = ws.getRow(1);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5C6B" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  ws.getColumn("universityNumber").numFmt = "@"; // keep leading zeros
  for (const row of data) ws.addRow(row);

  const numbers = [...new Set(ctx.groups.map((g) => g.number))].sort((a, b) => a - b);
  const last = Math.max(1000, data.length + 200);
  for (let r = 2; r <= last; r++) {
    ws.getCell(`D${r}`).dataValidation = {
      type: "list", allowBlank: true, formulae: ['"صباحي,مسائي"'], showErrorMessage: true, errorTitle: "الدوام", error: "اختر صباحي أو مسائي",
    };
    ws.getCell(`E${r}`).dataValidation = {
      type: "list", allowBlank: true, formulae: [`"${numbers.join(",")}"`], showErrorMessage: true, errorTitle: "المجموعة",
      error: `اختر رقم مجموعة: ${numbers.join("، ")}`,
    };
  }

  const help = wb.addWorksheet("تعليمات", { views: [{ rightToLeft: true }] });
  help.getColumn(1).width = 110;
  const lines = [
    `قالب طلاب ${ctx.courseLabel} — نوع الدراسة: ${ctx.studyTypeName}`,
    "",
    "• املأ ورقة «الطلاب» فقط، صفًا لكل طالب، دون تغيير عناوين الأعمدة.",
    "• الأعمدة المعلّمة بـ * إلزامية: الرقم الجامعي، الاسم الكامل، الدوام، المجموعة.",
    "• الرقم الجامعي هو المعرّف الثابت للطالب: إعادة الاستيراد تحدّث بيانات الطالب ولا تكرره.",
    "• الدوام: صباحي أو مسائي (اختر من القائمة).",
    `• المجموعة: رقم المجموعة داخل الدوام (${numbers.join(" أو ")}).`,
    "• الاسم بالإنكليزية والبريد الإلكتروني اختياريان.",
    "",
    "مجموعات الدورة الحالية:",
    ...ctx.groups.map((g) => `   ${SHIFT_AR[g.shift]} — المجموعة ${g.number}  (${g.name})`),
  ];
  lines.forEach((text, i) => {
    const cell = help.getCell(`A${i + 1}`);
    cell.value = text;
    if (i === 0) cell.font = { bold: true, size: 13 };
  });
  const buf = await wb.xlsx.writeBuffer();
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

/** Reads a filled template: the rows (with sheet row numbers), or an Arabic error. */
export async function readStudentTemplate(
  Excel: ExcelLib,
  data: ArrayBuffer
): Promise<{ rows: Array<StudentRowInput & { row: number }> } | { error: string }> {
  const wb = new Excel.Workbook() as Workbook;
  try {
    await wb.xlsx.load(data);
  } catch {
    return { error: "تعذّرت قراءة الملف — تأكد أنه ملف Excel بصيغة .xlsx" };
  }
  const colsOf = (s: Sheet) => {
    const m = new Map<TemplateKey, number>();
    s.getRow(1).eachCell((c, col) => {
      const k = headerKey(String(c.text ?? ""));
      if (k && !m.has(k)) m.set(k, col);
    });
    return m;
  };
  const ws = wb.worksheets.find((s) => {
    const m = colsOf(s);
    return m.has("universityNumber") && m.has("nameAr");
  });
  if (!ws) return { error: "لم يُعثر على ورقة بعناوين القالب (الرقم الجامعي، الاسم…) — استخدم القالب المنزَّل من التطبيق." };
  const colOf = colsOf(ws);
  const missing = TEMPLATE_COLUMNS.filter((c) => c.required && !colOf.has(c.key)).map((c) => c.header);
  if (missing.length) return { error: `أعمدة ناقصة في الملف: ${missing.join("، ")}` };
  const rows: Array<StudentRowInput & { row: number }> = [];
  ws.eachRow({ includeEmpty: false }, (r, n) => {
    if (n === 1) return;
    const get = (k: TemplateKey) => {
      const col = colOf.get(k);
      return col ? String(r.getCell(col).text ?? "").trim() : "";
    };
    const item = { row: n, universityNumber: get("universityNumber"), nameAr: get("nameAr"), nameEn: get("nameEn"), shift: get("shift"), group: get("group"), email: get("email") };
    if (Object.entries(item).some(([k, v]) => k !== "row" && v)) rows.push(item);
  });
  if (rows.length === 0) return { error: "الملف لا يحتوي على طلاب." };
  return { rows };
}
