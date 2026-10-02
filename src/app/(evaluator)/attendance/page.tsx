import { getSession } from "@/lib/auth";
import { todayISO } from "@/lib/date";
import { getAvailableGroupsForDate, getGroupDayRoster } from "@/lib/models/attendance";
import { GroupHeader, GroupPicker, NoGroupToday, pickSelectedGroup } from "../group-tabs";
import { AttendanceList } from "./attendance-list";

// الحضور والتقييم: today's group is loaded straight from the rotation
// schedule; with two groups today (morning and evening) the evaluator
// switches with the tabs. When a holiday moved the day, any of the
// evaluator's own groups can be loaded instead (GroupPicker).
export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const session = await getSession();
  const dateISO = todayISO();
  const { group: requested } = await searchParams;
  const groups = await getAvailableGroupsForDate(session!.sub, dateISO);
  const group = pickSelectedGroup(groups, requested);
  if (!group) return <NoGroupToday title="الحضور والتقييم" groups={groups} basePath="/attendance" />;
  const roster = await getGroupDayRoster(group.groupId, dateISO);

  return (
    <div className="flex flex-col gap-4">
      <GroupHeader group={group} dateISO={dateISO} title="الحضور والتقييم" />
      <GroupPicker groups={groups} selected={group} basePath="/attendance" />
      <AttendanceList key={group.groupId} readOnly={group.validated} rows={roster.rows} maxTotal={roster.maxTotal} />
    </div>
  );
}
