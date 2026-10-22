import { describe, expect, it } from "vitest";
import { checkShare, type EvaluatorBundle } from "@eva/core/sync/contract";
import { assignmentFiles, buildFile, fileProblem } from "./assignments";
import type { Assignment } from "./store";

const bundle = {
  evaluator: { id: "e1", name: "د. سارة" },
  groups: [
    { id: "g1", name: "المجموعة الصباحية 1", shift: "MORNING", students: [{ id: "s1", name: "زينب", universityNumber: "1" }, { id: "s2", name: "احمد", universityNumber: "2" }, { id: "s3", name: "مريم", universityNumber: "3" }] },
    { id: "g2", name: "المجموعة المسائية 1", shift: "EVENING", students: [{ id: "s4", name: "علي", universityNumber: "4" }] },
  ],
} as unknown as EvaluatorBundle;
let n = 0;
const newId = () => `a${++n}`;
const now = new Date("2026-10-26T09:00:00Z");

describe("assignment files", () => {
  it("one file holds several subjects, each with its own students, in the order written", () => {
    const made = buildFile(
      bundle,
      { id: "f1", title: "واجبات الأسبوع الثاني", dateISO: "2026-10-26" },
      [
        { title: "خطة رعاية", groupId: "g1", studentIds: ["s1", "s2"] },
        { title: "دراسة حالة", groupId: "g1", studentIds: ["s3"] },
        { title: "تقرير", groupId: "g2", studentIds: ["s4"], notes: " يسلّم الأحد " },
      ],
      { now, newId }
    );
    expect(made).toHaveLength(4);
    expect(made.every((a) => a.fileId === "f1" && a.fileTitle === "واجبات الأسبوع الثاني")).toBe(true);
    const [file] = assignmentFiles(made);
    expect(file.subjects.map((s) => [s.title, s.items.map((i) => i.studentName)])).toEqual([
      ["خطة رعاية", ["احمد", "زينب"]],
      ["دراسة حالة", ["مريم"]],
      ["تقرير", ["علي"]],
    ]);
    expect(file.groupIds).toEqual(["g1", "g2"]);
    expect(file.subjects[2].items[0].notes).toBe("يسلّم الأحد");
  });

  it("adding to a file later keeps its subjects first", () => {
    const first = buildFile(bundle, { id: "f1", title: "ملف", dateISO: "2026-10-26" }, [{ title: "ب", groupId: "g1", studentIds: ["s1"] }], { now, newId });
    const more = buildFile(bundle, { id: "f1", title: "ملف", dateISO: "2026-10-27" }, [{ title: "أ", groupId: "g1", studentIds: ["s2"] }], { startAt: 1, now, newId });
    const files = assignmentFiles([...more, ...first]);
    expect(files).toHaveLength(1);
    expect(files[0].subjects.map((s) => s.title)).toEqual(["ب", "أ"]);
    expect(files[0].dateISO).toBe("2026-10-26");
  });

  it("assignments without a file are grouped by date, newest first", () => {
    const old = (id: string, dateISO: string, title: string): Assignment => ({ id, groupId: "g1", studentId: "s1", studentName: "زينب", universityNumber: "1", title, dateISO, createdAt: "t" });
    const files = assignmentFiles([old("x", "2026-10-19", "أ"), old("y", "2026-10-20", "ب"), old("z", "2026-10-19", "ج")]);
    expect(files.map((f) => [f.title, f.count])).toEqual([["واجبات 2026-10-20", 1], ["واجبات 2026-10-19", 2]]);
  });

  it("says what is missing before saving", () => {
    expect(fileProblem([])).toBeTruthy();
    expect(fileProblem([{ title: "أ", groupId: "g1", studentIds: ["s1"] }, { title: " ", groupId: "g1", studentIds: ["s1"] }])).toBe("اكتب اسم الواجب (الواجب 2)");
    expect(fileProblem([{ title: "أ", groupId: "g1", studentIds: [] }])).toBe("اختر طالبًا واحدًا على الأقل");
    expect(fileProblem([{ title: "أ", groupId: "g1", studentIds: ["s1"] }])).toBeNull();
  });

  it("a file's assignments travel in a colleague share", () => {
    const made = buildFile(bundle, { id: "f1", title: "ملف", dateISO: "2026-10-26" }, [{ title: "أ", groupId: "g1", studentIds: ["s1"] }], { now, newId });
    const assignments = made.map(({ groupId: _g, createdAt: _c, ...a }) => a);
    const share = { id: "sh", kind: "share", fromId: "e1", fromName: "د. سارة", toId: "e2", groupId: "g1", dateISO: "2026-10-26", sentAt: "t", records: [], assignments };
    expect(checkShare(share)).toBeNull();
    expect(checkShare({ ...share, assignments: [{ ...assignments[0], position: -1 }] })).toBeTruthy();
  });
});
