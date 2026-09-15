import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";

// The Evaluator App shell (plan §2.4) — a separate, focused experience from
// the admin dashboard, built mobile-first per §2.3. The app is now
// installable and opens offline (Goal 4 Phase 4a); offline data/grading
// work continues in Phase 4b onward.
export default async function EvaluatorLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "EVALUATOR") {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-lg px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="font-bold" style={{ color: "var(--brand)" }}>
              Eva — تطبيق المقيّم
            </span>
            <nav className="flex gap-1">
              <Link href="/my" className="px-2 py-1 rounded-md text-sm text-slate-600 hover:bg-slate-100">
                طلابي
              </Link>
              <Link href="/schedule" className="px-2 py-1 rounded-md text-sm text-slate-600 hover:bg-slate-100">
                جدولي
              </Link>
            </nav>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="btn btn-secondary text-xs px-2 py-1">
              خروج
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
