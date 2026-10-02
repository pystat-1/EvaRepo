// Dev helper: makes "today" a scheduled grading day for whichever evaluator
// the EVA_AUTH_BYPASS flow impersonates, so the evaluator grade form (with the
// daily-note checkbox) can be exercised on demand. Adds a rotation block for
// today at that evaluator's hospital for one active group there.
import { prisma } from "../src/lib/db";
import { weekdayCodeOf } from "../src/lib/weekdays";

async function main() {
  const assignment = await prisma.evaluatorAssignment.findFirst({
    where: { active: true, account: { active: true, role: "EVALUATOR" } },
    include: { account: true, hospital: true },
  });
  if (!assignment) return console.log("no evaluator assignment found");

  const today = new Date().toISOString().slice(0, 10);
  const day = weekdayCodeOf(today);

  // A group to schedule at this hospital today: prefer one the assignment is
  // scoped to; else any active group with students.
  const group =
    (assignment.groupId
      ? await prisma.group.findUnique({ where: { id: assignment.groupId } })
      : null) ??
    (await prisma.group.findFirst({ where: { active: true, students: { some: { active: true } } } }));
  if (!group) return console.log("no group with students found");

  await prisma.rotationBlock.create({
    data: {
      groupId: group.id,
      hospitalId: assignment.hospitalId,
      startDate: today,
      endDate: today,
      daysOfWeek: day,
      notes: "[today-demo]",
    },
  });

  const students = await prisma.student.count({ where: { groupId: group.id, active: true } });
  console.log(`✓ Today (${today}, ${day}) is now a grading day for:`);
  console.log(`  evaluator: ${assignment.account.name} (${assignment.account.email})`);
  console.log(`  hospital:  ${assignment.hospital.name}`);
  console.log(`  group:     ${group.name} (${students} students)`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
