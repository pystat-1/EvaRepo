import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "ADMIN") redirect("/dashboard");
  if (session.role === "EVALUATOR") redirect("/my");
  if (session.role === "STUDENT") redirect("/me");
  redirect("/login");
}
