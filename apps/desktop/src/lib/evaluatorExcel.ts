// Evaluator Excel files: the import template (one row per cover), reading a
// filled one, and the sheet of phone logins to hand out.
import type { Workbook, Worksheet } from "exceljs";
import type { EvaluatorImportRow } from "@eva/db/repo/evaluators";
import { normalizeArabic } from "@eva/core/text/arabic";
import { loadExcel } from "./files";

const COLUMNS = [
  { key: "email", header: "البريد الإلكتروني (حساب Google) *", width: 34 },
  { key: "name", header: "الاسم (اختياري)", width: 28 },
  { key: "hospital", header: "المستشفى *", width: 24 },
  { key: "group", header: "المجموعة (فارغ = كل المجموعات)", width: 30 },
] as const;
type Key = (typeof COLUMNS)[number]["key"];

// Headers accepted when reading (Arabic from the template, English like the website's CSV).
const HEADER_ALIASES: Record<string, Key> = {
  name: "name", الاسم: "name",
  email: "email", "البريد الالكتروني": "email", البريد: "email",
  hospital: "hospital", المستشفي: "hospital",
  group: "group", المجموعه: "group",
};
function headerKey(text: string): Key | undefined {
  const base = normalizeArabic(text.replace(/\*|\(.*?\)/g, ""));
  return HEADER_ALIASES[base];
}

function styleHeader(ws: Worksheet) {
  const header = ws.getRow(1);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5C6B" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
}

async function bytes(wb: Workbook) {
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** The template, with drop-downs for the course's hospitals and groups, optionally pre-filled. */
export async function buildEvaluatorTemplate(
  choices: { hospitals: Array<{ name: string }>; groups: Array<{ name: string }> },
  data: Array<Record<Key, string>> = []
): Promise<Uint8Array> {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  wb.creator = "Eva";
  const ws = wb.addWorksheet("المقيّمون", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  styleHeader(ws);
  for (const row of data) ws.addRow(row);

  // Lists live on a hidden sheet so the drop-downs work for any length.
  const lists = wb.addWorksheet("قوائم", { state: "hidden" });
  choices.hospitals.forEach((h, i) => (lists.getCell(`A${i + 1}`).value = h.name));
  choices.groups.forEach((g, i) => (lists.getCell(`B${i + 1}`).value = g.name));
  const last = Math.max(300, data.length + 100);
  for (let r = 2; r <= last; r++) {
    if (choices.hospitals.length)
      ws.getCell(`C${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`'قوائم'!$A$1:$A$${choices.hospitals.length}`] };
    if (choices.groups.length)
      ws.getCell(`D${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`'قوائم'!$B$1:$B$${choices.groups.length}`] };
  }
  const help = wb.addWorksheet("طريقة التعبئة", { views: [{ rightToLeft: true }] });
  help.getColumn(1).width = 100;
  [
    "صف واحد لكل تخصيص: المقيّم الذي يغطي مستشفيين يُكتب في صفين بنفس البريد.",
    "البريد هو حساب Google الذي يدخل به المقيّم على الهاتف، وهو ما يربط الصفوف بالمقيّم الموجود.",
    "الاسم اختياري: إن تُرك فارغًا يُؤخذ من حساب Google عند أول دخول.",
    "اترك المجموعة فارغة ليغطي المقيّم كل مجموعات المستشفى حسب الجدول.",
    "لا توجد كلمات مرور: بعد الاستيراد تصل البيانات إلى الهواتف تلقائيًا.",
  ].forEach((line, i) => (help.getCell(`A${i + 1}`).value = line));
  return bytes(wb);
}

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: Array<{ text: string }> };
    if (o.richText) return o.richText.map((x) => x.text).join("");
    if (o.text !== undefined) return String(o.text); // hyperlinks (emails often become links)
    if (o.result !== undefined) return String(o.result);
  }
  return String(v);
};

export async function readEvaluatorTemplate(data: ArrayBuffer): Promise<{ rows: EvaluatorImportRow[] } | { error: string }> {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    return { error: "تعذّرت قراءة الملف. تأكد أنه ملف Excel (.xlsx)." };
  }
  const ws = wb.worksheets.find((s) => s.state !== "hidden") ?? wb.worksheets[0];
  if (!ws) return { error: "الملف فارغ" };
  const cols: Partial<Record<Key, number>> = {};
  ws.getRow(1).eachCell((cell, col) => {
    const k = headerKey(cellText(cell.value));
    if (k && !cols[k]) cols[k] = col;
  });
  if (!cols.email || !cols.hospital) return { error: "لم يُعثر على عمودي البريد الإلكتروني والمستشفى. استخدم قالب المقيّمين." };
  const rows: EvaluatorImportRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    const get = (k: Key) => (cols[k] ? cellText(row.getCell(cols[k]!).value).trim() : "");
    const r = { row: n, name: get("name"), email: get("email"), hospital: get("hospital"), group: get("group") };
    if (r.name || r.email || r.hospital || r.group) rows.push(r);
  });
  if (!rows.length) return { error: "لا توجد صفوف في الملف" };
  return { rows };
}
