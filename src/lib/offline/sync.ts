import { gradeStudentAction } from "@/lib/actions/grading";
import { listOutboxEntries, removeOutboxEntry, setOutboxEntryError, OutboxEntry } from "./db";
import type { GradeViewResult } from "./gradeData";

export type SyncOutcome = { studentId: string; dateISO: string } & (
  | { status: "synced" }
  | { status: "error"; message: string }
);

export interface SyncSummary {
  outcomes: SyncOutcome[];
  stoppedOffline: boolean;
}

const SCOPE_ERROR_MESSAGES: Record<string, string> = {
  out_of_scope: "لم تعد مخصصًا لهذا الطالب — راجع هذا التقييم يدويًا.",
  not_scheduled: "لم يعد هذا اليوم يوم حضور مجدول لمجموعة هذا الطالب — راجع هذا التقييم يدويًا.",
  not_covered: "لم تعد مخصصًا لمستشفى/مجموعة هذا الطالب في هذا اليوم — راجع هذا التقييم يدويًا.",
  not_found: "تعذّر إيجاد هذا الطالب على الخادم — راجع هذا التقييم يدويًا.",
};

function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);
}

function outboxFormData(entry: OutboxEntry): FormData {
  const fd = new FormData();
  fd.set("studentId", entry.studentId);
  fd.set("dateISO", entry.dateISO);
  fd.set("attendance", entry.attendance);
  if (entry.notes) fd.set("notes", entry.notes);
  if (entry.feedback) fd.set("feedback", entry.feedback);
  for (const [sectionId, value] of Object.entries(entry.scores)) {
    fd.set(`score_${sectionId}`, String(value));
  }
  return fd;
}

// Re-derives the current rubric shape the same way the online grading page
// already does (GET /api/grade/[studentId]) before blindly resubmitting a
// queued entry. This both re-checks scope/schedule (which may have changed
// on the server while the evaluator was offline — the outbox entry only
// proves it was valid *at queue time*) and catches the rubric-changed case
// the plan flags: if the server now has a rubric section this entry has no
// score for, submitting as-is would silently send 0 for a section the
// evaluator never saw, so that's surfaced as an error instead of guessed at.
async function checkStillValid(entry: OutboxEntry): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await fetch(`/api/grade/${entry.studentId}`, { cache: "no-store" });
  if (res.status === 401) {
    throw new TypeError("session expired mid-sync"); // treated as "still can't sync right now", not a data error
  }
  const body = (await res.json()) as GradeViewResult;
  if (!body.ok) {
    return { ok: false, message: SCOPE_ERROR_MESSAGES[body.reason] ?? "تعذّر التحقق من هذا التقييم — راجعه يدويًا." };
  }
  const currentSectionIds = body.sections.map((s) => s.id);
  const queuedSectionIds = new Set(Object.keys(entry.scores));
  const missing = currentSectionIds.filter((id) => !queuedSectionIds.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      message: "تغيّر معيار التقييم أثناء عدم اتصالك بالإنترنت — يرجى فتح هذا التقييم وإعادة حفظه يدويًا.",
    };
  }
  return { ok: true };
}

// Phase 4d's sync queue: replays everything queued in the Phase 4c outbox
// through the *existing* gradeStudentAction, so every server-side check it
// already does (assertEvaluatorCanGrade, upsertEvaluation) runs unchanged —
// this function adds no new write path, only a pre-flight validity check
// and outbox bookkeeping around the same call the online form already uses.
//
// True Background Sync API registration (firing even with the app closed)
// is deliberately not implemented here: it would need a plain fetch/POST
// endpoint the service worker can call without Next's Server Action
// wiring (a second write path to keep in sync with gradeStudentAction), and
// has no Safari/iOS support anyway. The `online` event + manual button
// below covers the realistic case (evaluator's connection returns while the
// app is open or backgrounded) — see PROJECT_GOALS.md Phase 4d notes.
export async function replayOutbox(): Promise<SyncSummary> {
  const entries = await listOutboxEntries();
  const outcomes: SyncOutcome[] = [];

  for (const entry of entries) {
    try {
      const validity = await checkStillValid(entry);
      if (!validity.ok) {
        await setOutboxEntryError(entry.studentId, entry.dateISO, validity.message);
        outcomes.push({ studentId: entry.studentId, dateISO: entry.dateISO, status: "error", message: validity.message });
        continue;
      }

      await gradeStudentAction(outboxFormData(entry));
      await removeOutboxEntry(entry.studentId, entry.dateISO);
      outcomes.push({ studentId: entry.studentId, dateISO: entry.dateISO, status: "synced" });
    } catch (err) {
      if (isNetworkFailure(err)) {
        // Still offline (or lost connection again mid-pass) — stop here
        // rather than mark every remaining entry as an error; try again on
        // the next online event.
        return { outcomes, stoppedOffline: true };
      }
      const message = err instanceof Error ? err.message : "فشل غير متوقع أثناء المزامنة";
      await setOutboxEntryError(entry.studentId, entry.dateISO, message);
      outcomes.push({ studentId: entry.studentId, dateISO: entry.dateISO, status: "error", message });
    }
  }

  return { outcomes, stoppedOffline: false };
}
