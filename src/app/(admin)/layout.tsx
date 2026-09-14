import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { countUnseenFlags } from "@/lib/models/flags";

const NAV = [
  { href: "/dashboard", label: "الرئيسية" },
  { href: "/setup", label: "الإعداد" },
  { href: "/students", label: "الطلاب" },
  { href: "/courses", label: "الدورات" },
  { href: "/groups", label: "المجموعات" },
  { href: "/hospitals", label: "المستشفيات" },
  { href: "/study-types", label: "أنواع الدراسة" },
  { href: "/evaluators", label: "المقيّمون" },
  { href: "/rubric", label: "معيار التقييم" },
  { href: "/statistics", label: "الإحصائيات" },
  { href: "/flags", label: "التنبيهات" },
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
      <header className="border-b bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 flex-wrap">
            <span className="font-bold" style={{ color: "var(--brand)" }}>
              Eva — لوحة المدير
            </span>
            <nav className="flex gap-1 flex-wrap">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100 relative"
                >
                  {item.label}
                  {item.href === "/flags" && unseenFlags > 0 && (
                    <span className="absolute -top-1 -left-1 bg-red-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                      {unseenFlags}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{session.name}</span>
            <form action={logoutAction}>
              <button type="submit" className="btn btn-secondary">
                تسجيل الخروج
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
