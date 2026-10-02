import { getSession } from "@/lib/auth";
import { todayISO } from "@/lib/date";
import { isWithinSubmissionWindow } from "@/lib/evaluator/validation";
import { getAvailableGroupsForDate, getGroupDayGrades } from "@/lib/models/attendance";
import { listRubricSections, getMaxTotal } from "@/lib/models/rubric";
import { getWorkDay } from "@/lib/models/workDays";
import { GroupHeader, GroupPicker, NoGroupToday, pickSelectedGroup } from "../group-tabs";
import { DayGradesTable } from "./day-grades-table";

// درجات اليوم: the whole group as one table (students × criteria items),
// writing the same evaluation records as the grading form and autosaving
// every change. اعتماد at the bottom closes the day and releases it to the
// admin. ?date= opens an earlier day that still needs finishing or
// validating (within the 7-day window), e.g. from the reminder banner.
export default async function DayGradesPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; date?: string }>;
}) {
  const session = await getSession();
  const today = todayISO();
  const { group: requested, date } = await searchParams;
  // An earlier day opens if it is inside the 7-day edit window, or if it is
  // a worked day still waiting for validation (it can then be validated
  // even though its grades can no longer be edited).
  let dateISO = today;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today) {
    const pending = requested ? await getWorkDay(requested, date) : null;
    if (isWithinSubmissionWindow(date, today) || (pending && !pending.validatedAt)) dateISO = date;
  }

  const groups = await getAvailableGroupsForDate(session!.sub, dateISO);
  const group = pickSelectedGroup(groups, requested);
  if (!group) return <NoGroupToday title="درجات اليوم" groups={groups} basePath="/day-grades" />;

  const [rows, sections, maxTotal] = await Promise.all([
    getGroupDayGrades(group.groupId, dateISO),
    listRubricSections(),
    getMaxTotal(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <GroupHeader group={group} dateISO={dateISO} title={dateISO === today ? "درجات اليوم" : `درجات يوم ${dateISO}`} />
      {dateISO === today && <GroupPicker groups={groups} selected={group} basePath="/day-grades" />}
      <DayGradesTable
        key={`${group.groupId}:${dateISO}`}
        groupId={group.groupId}
        dateISO={dateISO}
        isToday={dateISO === today}
        validated={group.validated}
        sections={sections}
        maxTotal={maxTotal}
        rows={rows}
      />
    </div>
  );
}
