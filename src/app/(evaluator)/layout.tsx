import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";

// The Evaluator App shell (plan §2.4) — a separate, focused experience from
// the admin dashboard, built mobile-first per §2.3. This is a static shell
// today; the offline/installable-PWA work is scoped for Phase 3, once
// there is an actual daily workflow (grading) worth taking offline.
export default async function EvaluatorLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "EVALUATOR") {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-lg px-4 py-3 flex items-center justify-between">
          <span className="font-bold" style={{ color: "var(--brand)" }}>
            Eva — تطبيق المقيّم
          </span>
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
