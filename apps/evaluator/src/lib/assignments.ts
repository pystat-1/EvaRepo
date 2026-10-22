// الواجبات organised into files: a file (ملف واجبات) holds several
// subjects, each with its own students — e.g. 2 students on «خطة رعاية»
// and 3 on «دراسة حالة» — written in one go and downloaded as one file,
// subject by subject. Assignments from before files existed (or saved one
// by one) are grouped by their date. Pure functions: easy to test.
import type { EvaluatorBundle } from "@eva/core/sync/contract";
import { compareArabic } from "@eva/core/text/arabic";
import type { Assignment } from "./store";

export interface AssignmentSubject {
  title: string;
  dateISO: string;
  position: number;
  items: Assignment[]; // by student name
}

export interface AssignmentFile {
  key: string;
  fileId: string | null; // null: assignments of one date saved before files existed
  title: string;
  dateISO: string; // the earliest date in the file
  groupIds: string[];
  subjects: AssignmentSubject[];
  count: number;
  from?: string; // a colleague's file
}

export const dayFileTitle = (dateISO: string) => `واجبات ${dateISO}`;

/** Every assignment in its file, newest file first; in a file, subjects in the order written. */
export function assignmentFiles(list: Assignment[]): AssignmentFile[] {
  const files = new Map<string, Assignment[]>();
  for (const a of list) {
    const key = a.fileId ? `file:${a.fileId}` : `day:${a.dateISO}`;
    files.set(key, [...(files.get(key) ?? []), a]);
  }
  return [...files.entries()]
    .map(([key, items]): AssignmentFile => {
      const subjects = new Map<string, Assignment[]>();
      for (const a of items) {
        const k = `${a.title}\u0000${a.dateISO}`;
        subjects.set(k, [...(subjects.get(k) ?? []), a]);
      }
      const first = items[0];
      return {
        key,
        fileId: first.fileId ?? null,
        title: first.fileTitle?.trim() || dayFileTitle(first.dateISO),
        dateISO: items.reduce((m, a) => (a.dateISO < m ? a.dateISO : m), first.dateISO),
        groupIds: [...new Set(items.map((a) => a.groupId))],
        subjects: [...subjects.values()]
          .map((xs) => ({
            title: xs[0].title,
            dateISO: xs[0].dateISO,
            position: Math.min(...xs.map((x) => x.position ?? Number.MAX_SAFE_INTEGER)),
            items: [...xs].sort((a, b) => compareArabic(a.studentName, b.studentName)),
          }))
          .sort((a, b) => a.position - b.position || a.dateISO.localeCompare(b.dateISO) || compareArabic(a.title, b.title)),
        count: items.length,
        ...(items.some((a) => a.from) ? { from: items.find((a) => a.from)!.from } : {}),
      };
    })
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || compareArabic(a.title, b.title));
}

/** One subject being written: its name, its group and the students picked. */
export interface SubjectDraft {
  title: string;
  groupId: string;
  studentIds: string[];
  notes?: string;
}

/** What still blocks saving the file, or null. */
export function fileProblem(subjects: SubjectDraft[]): string | null {
  if (subjects.length === 0) return "أضف واجبًا واحدًا على الأقل";
  for (const [i, s] of subjects.entries()) {
    const n = subjects.length > 1 ? ` (الواجب ${i + 1})` : "";
    if (!s.title.trim()) return `اكتب اسم الواجب${n}`;
    if (s.studentIds.length === 0) return `اختر طالبًا واحدًا على الأقل${n}`;
  }
  return null;
}

/**
 * The assignments a file's subjects make, all in one file. `startAt`: the
 * position after the subjects the file already has (adding to a file).
 */
export function buildFile(
  bundle: EvaluatorBundle,
  file: { id: string; title: string; dateISO: string },
  subjects: SubjectDraft[],
  o: { startAt?: number; now: Date; newId: () => string }
): Assignment[] {
  const createdAt = o.now.toISOString();
  return subjects.flatMap((s, i) => {
    const group = bundle.groups.find((g) => g.id === s.groupId);
    return (group?.students ?? [])
      .filter((st) => s.studentIds.includes(st.id))
      .map((st) => ({
        id: o.newId(),
        groupId: s.groupId,
        studentId: st.id,
        studentName: st.name,
        universityNumber: st.universityNumber,
        title: s.title.trim(),
        dateISO: file.dateISO,
        ...(s.notes?.trim() ? { notes: s.notes.trim() } : {}),
        fileId: file.id,
        fileTitle: file.title.trim() || dayFileTitle(file.dateISO),
        position: (o.startAt ?? 0) + i,
        createdAt,
      }));
  });
}
