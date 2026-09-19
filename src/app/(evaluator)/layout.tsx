import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { OfflineSyncStatus } from "./offline-sync-status";

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
      <div className="h-[3px]" style={{ background: "var(--brand-dark)" }} />
      <header className="border-b" style={{ background: "var(--surface-raised)", borderColor: "var(--border)" }}>
        <div className="mx-auto w-full max-w-lg sm:max-w-2xl lg:max-w-4xl px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="font-display font-extrabold text-[15px]" style={{ color: "var(--brand-dark)" }}>
              Eva
            </span>
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: "var(--brand-tint)", color: "var(--brand-dark)" }}
            >
              تطبيق المقيّم
            </span>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="btn btn-secondary text-xs px-2.5 py-1">
              خروج
            </button>
          </form>
        </div>
        <nav className="mx-auto w-full max-w-lg sm:max-w-2xl lg:max-w-4xl px-4 sm:px-6 flex gap-4">
          <Link
            href="/my"
            className="pb-2.5 pt-1 text-[13.5px] font-semibold border-b-2"
            style={{ color: "var(--ink-muted)", borderColor: "transparent" }}
          >
            طلابي
          </Link>
          <Link
            href="/schedule"
            className="pb-2.5 pt-1 text-[13.5px] font-semibold border-b-2"
            style={{ color: "var(--ink-muted)", borderColor: "transparent" }}
          >
            جدولي
          </Link>
          <Link
            href="/history"
            className="pb-2.5 pt-1 text-[13.5px] font-semibold border-b-2"
            style={{ color: "var(--ink-muted)", borderColor: "transparent" }}
          >
            التقييمات السابقة
          </Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-lg sm:max-w-2xl lg:max-w-4xl flex-1 px-4 sm:px-6 py-6 flex flex-col gap-4">
        <OfflineSyncStatus />
        {children}
      </main>
    </div>
  );
}
