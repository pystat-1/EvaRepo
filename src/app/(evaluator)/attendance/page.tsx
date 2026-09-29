import { getSession } from "@/lib/auth";
import { todayISO } from "@/lib/date";
import { getGroupDayRoster, getScheduledGroupsForDate } from "@/lib/models/attendance";
import { GroupHeader, GroupTabs, NoGroupToday } from "../group-tabs";
import { AttendanceList } from "./attendance-list";

// الحضور والتقييم: today's group is loaded straight from the rotation
// schedule (no picking a list by hand); with two groups today (morning and
// evening) the evaluator switches with the tabs.
export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const session = await getSession();
  const dateISO = todayISO();
  const { group: requested } = await searchParams;
  const groups = await getScheduledGroupsForDate(session!.sub, dateISO);
  if (groups.length === 0) return <NoGroupToday title="الحضور والتقييم" />;

  const group = groups.find((g) => g.groupId === requested) ?? groups[0];
  const roster = await getGroupDayRoster(group.groupId, dateISO);

  return (
    <div className="flex flex-col gap-4">
      <GroupHeader group={group} dateISO={dateISO} title="الحضور والتقييم" />
      <GroupTabs groups={groups} selectedId={group.groupId} basePath="/attendance" />
      <AttendanceList key={group.groupId} rows={roster.rows} maxTotal={roster.maxTotal} />
    </div>
  );
}
