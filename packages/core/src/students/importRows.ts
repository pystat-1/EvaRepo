// Rules for the student Excel template (قالب الطلاب), shared by the browser
// (which reads the file and shows the preview) and the server (which
// re-validates every row it is sent). Pure: no DB, no Excel library.

export type ShiftCode = "MORNING" | "EVENING";

export interface StudentRowInput {
  universityNumber: string;
  nameAr: string;
  nameEn?: string;
  shift: string; // as typed: صباحي / مسائي (or Morning / Evening)
  group: string; // group number as typed, e.g. "1" or "١"
  email?: string;
}

export interface StudentRow {
  universityNumber: string;
  nameAr: string;
  nameEn: string | null;
  shift: ShiftCode;
  groupNumber: number;
  email: string | null;
}

export interface RowIssue {
  row: number; // spreadsheet row number (header is row 1)
  message: string;
}

// Template columns, in order. Headers are matched loosely (see headerKey).
export const TEMPLATE_COLUMNS = [
  { key: "universityNumber", header: "الرقم الجامعي", required: true, width: 18 },
  { key: "nameAr", header: "الاسم الكامل (عربي)", required: true, width: 34 },
  { key: "nameEn", header: "الاسم بالإنكليزية (اختياري)", required: false, width: 30 },
  { key: "shift", header: "الدوام (صباحي/مسائي)", required: true, width: 20 },
  { key: "group", header: "المجموعة (رقم)", required: true, width: 16 },
  { key: "email", header: "البريد الإلكتروني (اختياري)", required: false, width: 30 },
] as const;

export type TemplateKey = (typeof TEMPLATE_COLUMNS)[number]["key"];

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

// Maps a header cell to a template key: exact template header, or a few
// obvious alternatives, so a re-typed header still imports.
export function headerKey(header: string): TemplateKey | null {
  const h = header.replace(/\s+/g, " ").trim().toLowerCase();
  if (!h) return null;
  if (h.startsWith("الرقم الجامعي") || h === "university number" || h === "universitynumber") return "universityNumber";
  if (h.startsWith("الاسم بالإنكليزية") || h.startsWith("الاسم بالانكليزية") || h.startsWith("الاسم بالإنجليزية") || h === "nameen" || h === "english name")
    return "nameEn";
  if (h.startsWith("الاسم") || h === "namear" || h === "name") return "nameAr";
  if (h.startsWith("الدوام") || h.startsWith("الوردية") || h === "shift") return "shift";
  if (h.startsWith("المجموعة") || h === "group") return "group";
  if (h.startsWith("البريد") || h === "email") return "email";
  return null;
}

export function parseShift(value: string): ShiftCode | null {
  const v = value.trim().toLowerCase();
  if (["صباحي", "صباحية", "صباح", "morning", "am"].includes(v)) return "MORNING";
  if (["مسائي", "مسائية", "مساء", "evening", "pm"].includes(v)) return "EVENING";
  return null;
}

export function parseGroupNumber(value: string): number | null {
  const m = toLatinDigits(value).match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// The number a course group is known by in the template: the last number
// in its name, e.g. "المجموعة الصباحية 2" -> 2.
export function groupNumberFromName(name: string): number | null {
  const all = toLatinDigits(name).match(/\d+/g);
  return all ? Number(all[all.length - 1]) : null;
}

export function groupKey(shift: ShiftCode, n: number): string {
  return `${shift}:${n}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validates every row against the course's groups (keys from groupKey).
// Returns the clean rows and every problem found, with its sheet row.
export function validateRows(
  rows: Array<StudentRowInput & { row: number }>,
  groupKeys: Set<string>
): { valid: StudentRow[]; issues: RowIssue[] } {
  const valid: StudentRow[] = [];
  const issues: RowIssue[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    const universityNumber = toLatinDigits(r.universityNumber ?? "").trim();
    const nameAr = (r.nameAr ?? "").replace(/\s+/g, " ").trim();
    const problems: string[] = [];
    if (!universityNumber) problems.push("الرقم الجامعي فارغ");
    if (!nameAr) problems.push("الاسم فارغ");
    const shift = parseShift(r.shift ?? "");
    if (!shift) problems.push(`الدوام "${r.shift ?? ""}" غير معروف (صباحي أو مسائي)`);
    const groupNumber = parseGroupNumber(r.group ?? "");
    if (!groupNumber) problems.push(`رقم المجموعة "${r.group ?? ""}" غير صالح`);
    else if (shift && !groupKeys.has(groupKey(shift, groupNumber)))
      problems.push(`لا توجد مجموعة ${shift === "MORNING" ? "صباحية" : "مسائية"} رقم ${groupNumber} في الدورة`);
    const email = (r.email ?? "").trim();
    if (email && !EMAIL.test(email)) problems.push(`البريد "${email}" غير صالح`);
    if (universityNumber) {
      const first = seen.get(universityNumber);
      if (first !== undefined) problems.push(`الرقم الجامعي مكرر (أول ظهور في الصف ${first})`);
      else seen.set(universityNumber, r.row);
    }
    if (problems.length > 0) {
      issues.push({ row: r.row, message: problems.join("، ") });
      continue;
    }
    valid.push({
      universityNumber,
      nameAr,
      nameEn: (r.nameEn ?? "").trim() || null,
      shift: shift!,
      groupNumber: groupNumber!,
      email: email || null,
    });
  }
  return { valid, issues };
}
