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
        <h1 className="text-2xl font-bold">لوحة المدير</h1>
        <p className="text-slate-500 mt-1">
          نظرة عامة عبر المراحل الثلاث: قاعدة البيانات، المقيّمون، والتقييم.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="card hover:shadow-sm transition-shadow">
            <div
              className="text-3xl font-bold"
              style={{ color: c.highlight ? "#dc2626" : "var(--brand)" }}
            >
              {c.value}
            </div>
            <div className="text-sm text-slate-500 mt-1">{c.label}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
