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
      <header className="border-b bg-white">
        <div className="mx-auto max-w-lg px-4 py-3 flex items-center justify-between">
          <span className="font-bold" style={{ color: "var(--brand)" }}>
            Eva — بوابة الطالب
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
