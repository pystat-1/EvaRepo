import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { countUnseenFlags } from "@/lib/models/flags";
import NavLink from "./NavLink";

// The course-setup entities (students, courses, groups, hospitals, study
// types, evaluators) are now driven through the step-by-step "إعداد الدورة"
// wizard and viewed together in "الجدول الشامل" — so they no longer get
// their own top-level tabs (their pages still exist and are reachable via
// the "تحرير" links inside the wizard/workbook). Tabs unrelated to setup,
// like the grading center, are kept as they were.
const NAV = [
  { href: "/dashboard", label: "الرئيسية" },
  { href: "/setup", label: "إعداد الدورة" },
  { href: "/master", label: "الجدول الشامل" },
  { href: "/grading-center", label: "مركز التقييم" },
  { href: "/rubric", label: "معيار التقييم" },
  { href: "/statistics", label: "الإحصائيات" },
  { href: "/flags", label: "التنبيهات" },
  { href: "/sessions", label: "جلسات المقيّمين" },
  { href: "/student-accounts", label: "حسابات الطلاب" },
  { href: "/audit-log", label: "سجل التغييرات" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    redirect("/login");
  }

  const unseenFlags = await countUnseenFlags();

  return (
    <div className="flex flex-1 flex-col">
      <div className="h-[3px]" style={{ background: "var(--brand-dark)" }} />
      <header className="border-b" style={{ background: "var(--surface-raised)", borderColor: "var(--border)" }}>
        <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8 pt-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span
              className="font-display font-extrabold text-[15px] tracking-tight"
              style={{ color: "var(--brand-dark)" }}
            >
              Eva
            </span>
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: "var(--brand-tint)", color: "var(--brand-dark)" }}
            >
              لوحة المدير
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span style={{ color: "var(--ink-muted)" }}>{session.name}</span>
            <form action={logoutAction}>
              <button type="submit" className="btn btn-secondary">
                تسجيل الخروج
              </button>
            </form>
          </div>
        </div>
        <nav className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8 flex gap-4 overflow-x-auto">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href} badge={item.href === "/flags" ? unseenFlags : undefined}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 sm:px-6 lg:px-8 py-7">{children}</main>
    </div>
  );
}
