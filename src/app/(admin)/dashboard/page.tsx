import Link from "next/link";
import { listStudents } from "@/lib/models/students";
import { listGroups } from "@/lib/models/groups";
import { listHospitals } from "@/lib/models/hospitals";
import { listStudyTypes } from "@/lib/models/studyTypes";
import { listEvaluators } from "@/lib/models/evaluators";
import { getOverallStats } from "@/lib/models/statistics";
import { countUnseenFlags } from "@/lib/models/flags";

export default async function DashboardPage() {
  const [students, groups, hospitals, studyTypes, evaluators, overall, unseenFlags] = await Promise.all([
    listStudents(),
    listGroups(),
    listHospitals(),
    listStudyTypes(),
    listEvaluators(),
    getOverallStats(),
    countUnseenFlags(),
  ]);

  const cards = [
    { label: "الطلاب النشطون", value: students.length, href: "/students" },
    { label: "المجموعات", value: groups.length, href: "/groups" },
    { label: "المستشفيات", value: hospitals.length, href: "/hospitals" },
    { label: "أنواع الدراسة", value: studyTypes.length, href: "/study-types" },
    { label: "المقيّمون", value: evaluators.length, href: "/evaluators" },
    { label: "التقييمات المسجّلة", value: overall.totalEvaluations, href: "/statistics" },
    {
      label: "تنبيهات غير مراجعة",
      value: unseenFlags,
      href: "/flags",
      highlight: unseenFlags > 0,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold font-display" style={{ color: "var(--ink)" }}>
          لوحة المدير
        </h1>
        <p className="mt-1" style={{ color: "var(--ink-muted)" }}>
          نظرة عامة عبر المراحل الثلاث: قاعدة البيانات، المقيّمون، والتقييم.
        </p>
      </div>
      <div className="stat-strip grid-cols-2 sm:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="stat-tile">
            <div className="stat-value" style={c.highlight ? { color: "var(--red-700)" } : undefined}>
              {c.value}
            </div>
            <div className="stat-label">{c.label}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
