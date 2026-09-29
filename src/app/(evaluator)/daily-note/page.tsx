import { getSession } from "@/lib/auth";
import { todayISO } from "@/lib/date";
import { getGroupDayRoster, getScheduledGroupsForDate } from "@/lib/models/attendance";
import { GroupHeader, GroupTabs, NoGroupToday } from "../group-tabs";
import { DailyNoteList } from "./daily-note-list";

// تسليم الديلي نوت: who handed in today's daily note, for the group the
// schedule puts in front of this evaluator. Absent students are left out.
export default async function DailyNotePage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const session = await getSession();
  const dateISO = todayISO();
  const { group: requested } = await searchParams;
  const groups = await getScheduledGroupsForDate(session!.sub, dateISO);
  if (groups.length === 0) return <NoGroupToday title="تسليم الديلي نوت" />;

  const group = groups.find((g) => g.groupId === requested) ?? groups[0];
  const roster = await getGroupDayRoster(group.groupId, dateISO);

  return (
    <div className="flex flex-col gap-4">
      <GroupHeader group={group} dateISO={dateISO} title="تسليم الديلي نوت" />
      <GroupTabs groups={groups} selectedId={group.groupId} basePath="/daily-note" />
      <DailyNoteList key={group.groupId} rows={roster.rows} />
    </div>
  );
}
