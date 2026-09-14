// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import { prisma } from "../db";
import { getMaxTotal } from "./rubric";

export interface GroupStat {
  groupId: string;
  groupName: string;
  hospitalName: string | null;
  evaluationCount: number;
  studentCount: number;
  averageTotal: number;
  passRate: number; // fraction of evaluations >= 60% of max
}

export interface HospitalStat {
  hospitalId: string;
  hospitalName: string;
  evaluationCount: number;
  averageTotal: number;
}

const PASS_RATIO = 0.6;

export async function getGroupStats(): Promise<GroupStat[]> {
  const maxTotal = await getMaxTotal();
  const passThreshold = maxTotal * PASS_RATIO;

  const today = new Date().toISOString().slice(0, 10);
  const groups = await prisma.group.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    include: {
      rotationBlocks: {
        where: { active: true, startDate: { lte: today }, endDate: { gte: today } },
        include: { hospital: { select: { name: true } } },
        take: 1,
      },
      _count: { select: { students: { where: { active: true } } } },
    },
  });

  const groupIds = groups.map((g: any) => g.id);

  const [evalAgg, passAgg] = await Promise.all([
    prisma.evaluation.groupBy({
      by: ["groupId"],
      where: { groupId: { in: groupIds } },
      _count: { _all: true },
      _avg: { total: true },
    }),
    prisma.evaluation.groupBy({
      by: ["groupId"],
      where: { groupId: { in: groupIds }, total: { gte: passThreshold } },
      _count: { _all: true },
    }),
  ]);

  const evalByGroup = new Map(evalAgg.map((r) => [r.groupId, r]));
  const passByGroup = new Map(passAgg.map((r) => [r.groupId, r._count._all]));

  return groups.map((g: any) => {
    const agg = evalByGroup.get(g.id);
    const evaluationCount = agg?._count._all ?? 0;
    const passCount = passByGroup.get(g.id) ?? 0;
    return {
      groupId: g.id,
      groupName: g.name,
      hospitalName: g.rotationBlocks[0]?.hospital.name ?? null,
      evaluationCount,
      studentCount: g._count.students,
      averageTotal: agg?._avg.total ?? 0,
      passRate: evaluationCount > 0 ? passCount / evaluationCount : 0,
    };
  });
}

export async function getHospitalStats(): Promise<HospitalStat[]> {
  const hospitals = await prisma.hospital.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
  const hospitalIds = hospitals.map((h: any) => h.id);

  const evalAgg = await prisma.evaluation.groupBy({
    by: ["hospitalId"],
    where: { hospitalId: { in: hospitalIds } },
    _count: { _all: true },
    _avg: { total: true },
  });
  const evalByHospital = new Map(evalAgg.map((r) => [r.hospitalId, r]));

  return hospitals.map((h: any) => {
    const agg = evalByHospital.get(h.id);
    return {
      hospitalId: h.id,
      hospitalName: h.name,
      evaluationCount: agg?._count._all ?? 0,
      averageTotal: agg?._avg.total ?? 0,
    };
  });
}

export async function getOverallStats() {
  const [totalEvaluations, avg, maxTotal] = await Promise.all([
    prisma.evaluation.count(),
    prisma.evaluation.aggregate({ _avg: { total: true } }),
    getMaxTotal(),
  ]);
  return {
    totalEvaluations,
    averageTotal: avg._avg.total ?? 0,
    maxTotal,
  };
}
