import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildStudentTemplate, readStudentTemplate } from "./excelTemplate";

const ctx = {
  courseLabel: "دورة التمريض الأولى 2026",
  studyTypeName: "التمريض",
  groups: [
    { shift: "MORNING" as const, number: 1, name: "المجموعة الصباحية 1" },
    { shift: "EVENING" as const, number: 2, name: "المجموعة المسائية 2" },
  ],
};

const toArrayBuffer = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

describe("student Excel template", () => {
  it("round-trips: a pre-filled template reads back the same rows", async () => {
    const data = [
      { universityNumber: "0441001", nameAr: "زينب علي", nameEn: "Zainab", shift: "صباحي", group: "1", email: "z@x.iq" },
      { universityNumber: "0441002", nameAr: "حسين كريم", nameEn: "", shift: "مسائي", group: "2", email: "" },
    ];
    const bytes = await buildStudentTemplate(ExcelJS, ctx, data);
    const read = await readStudentTemplate(ExcelJS, toArrayBuffer(bytes));
    expect("rows" in read && read.rows).toEqual([
      { row: 2, ...data[0] },
      { row: 3, ...data[1] },
    ]);
  });

  it("has the RTL sheet, dropdowns and the instructions sheet", async () => {
    const bytes = await buildStudentTemplate(ExcelJS, ctx);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(toArrayBuffer(bytes));
    const ws = wb.getWorksheet("الطلاب")!;
    expect(wb.worksheets.map((w) => w.name)).toEqual(["الطلاب", "تعليمات"]);
    expect((ws.views[0] as { rightToLeft?: boolean }).rightToLeft).toBe(true);
    expect(ws.getCell("E2").dataValidation.formulae).toEqual(['"1,2"']);
  });

  it("explains unusable files in Arabic", async () => {
    expect(await readStudentTemplate(ExcelJS, new TextEncoder().encode("not excel").buffer as ArrayBuffer)).toEqual({
      error: "تعذّرت قراءة الملف — تأكد أنه ملف Excel بصيغة .xlsx",
    });
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("x").addRow(["a", "b"]);
    const other = await wb.xlsx.writeBuffer();
    const res = await readStudentTemplate(ExcelJS, other as ArrayBuffer);
    expect("error" in res && res.error).toMatch(/عناوين القالب/);
  });
});
