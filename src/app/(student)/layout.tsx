import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "STUDENT" || !session.studentId) {
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
              بوابة الطالب
            </span>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="btn btn-secondary text-xs px-2.5 py-1">
              خروج
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-lg sm:max-w-2xl lg:max-w-4xl flex-1 px-4 sm:px-6 py-6">{children}</main>
    </div>
  );
}
