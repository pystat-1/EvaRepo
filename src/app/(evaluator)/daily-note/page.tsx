import { getSession } from "@/lib/auth";
import { todayISO } from "@/lib/date";
import { getAvailableGroupsForDate, getGroupDayRoster } from "@/lib/models/attendance";
import { GroupHeader, GroupPicker, NoGroupToday, pickSelectedGroup } from "../group-tabs";
import { DailyNoteList } from "./daily-note-list";

// تسليم الديلي نوت: who handed in today's daily note, for the group the
// schedule puts in front of this evaluator. Absent students are left out.
export default async function DailyNotePage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const session = await getSession();
  const dateISO = todayISO();
  const { group: requested } = await searchParams;
  const groups = await getAvailableGroupsForDate(session!.sub, dateISO);
  const group = pickSelectedGroup(groups, requested);
  if (!group) return <NoGroupToday title="تسليم الديلي نوت" groups={groups} basePath="/daily-note" />;
  const roster = await getGroupDayRoster(group.groupId, dateISO);

  return (
    <div className="flex flex-col gap-4">
      <GroupHeader group={group} dateISO={dateISO} title="تسليم الديلي نوت" />
      <GroupPicker groups={groups} selected={group} basePath="/daily-note" />
      <DailyNoteList key={group.groupId} readOnly={group.validated} rows={roster.rows} />
    </div>
  );
}
