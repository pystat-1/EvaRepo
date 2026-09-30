import { describe, expect, it } from "vitest";
import { groupKey, groupNumberFromName, headerKey, parseGroupNumber, parseShift, validateRows } from "./importRows";

const groups = new Set([groupKey("MORNING", 1), groupKey("MORNING", 2), groupKey("EVENING", 1)]);

describe("header and cell parsing", () => {
  it("matches template and common alternative headers", () => {
    expect(headerKey("الرقم الجامعي")).toBe("universityNumber");
    expect(headerKey("الاسم الكامل (عربي)")).toBe("nameAr");
    expect(headerKey("الاسم بالإنكليزية (اختياري)")).toBe("nameEn");
    expect(headerKey("الوردية")).toBe("shift");
    expect(headerKey("Group")).toBe("group");
    expect(headerKey("ملاحظات")).toBeNull();
  });

  it("reads shifts in Arabic and English", () => {
    expect(parseShift("صباحي")).toBe("MORNING");
    expect(parseShift(" مسائية ")).toBe("EVENING");
    expect(parseShift("Evening")).toBe("EVENING");
    expect(parseShift("ليلي")).toBeNull();
  });

  it("reads group numbers including Arabic-Indic digits and labels", () => {
    expect(parseGroupNumber("2")).toBe(2);
    expect(parseGroupNumber("٣")).toBe(3);
    expect(parseGroupNumber("المجموعة 1")).toBe(1);
    expect(parseGroupNumber("أ")).toBeNull();
  });

  it("takes a course group's number from the end of its name", () => {
    expect(groupNumberFromName("المجموعة الصباحية 2")).toBe(2);
    expect(groupNumberFromName("المجموعة المسائية ٣")).toBe(3);
    expect(groupNumberFromName("المجموعة أ")).toBeNull();
  });
});

describe("validateRows", () => {
  const row = (r: number, over: Record<string, string> = {}) => ({
    row: r,
    universityNumber: `U${r}`,
    nameAr: "زينب علي",
    shift: "صباحي",
    group: "1",
    ...over,
  });

  it("accepts good rows and normalises them", () => {
    const { valid, issues } = validateRows([row(2, { universityNumber: "٤٤٢١", nameAr: "  زينب   علي " })], groups);
    expect(issues).toEqual([]);
    expect(valid).toEqual([
      { universityNumber: "4421", nameAr: "زينب علي", nameEn: null, shift: "MORNING", groupNumber: 1, email: null },
    ]);
  });

  it("reports every problem with its sheet row", () => {
    const { valid, issues } = validateRows(
      [
        row(2, { universityNumber: "" }),
        row(3, { shift: "ليلي" }),
        row(4, { shift: "مسائي", group: "2" }),
        row(5, { email: "bad@" }),
      ],
      groups
    );
    expect(valid).toEqual([]);
    expect(issues.map((i) => i.row)).toEqual([2, 3, 4, 5]);
    expect(issues[2].message).toMatch(/مسائية رقم 2/);
  });

  it("rejects a university number repeated in the file", () => {
    const { valid, issues } = validateRows([row(2), row(3, { universityNumber: "U2" })], groups);
    expect(valid).toHaveLength(1);
    expect(issues[0]).toEqual({ row: 3, message: "الرقم الجامعي مكرر (أول ظهور في الصف 2)" });
  });
});
