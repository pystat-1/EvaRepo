import { NextRequest, NextResponse } from "next/server";
import { DEV_ROLE_COOKIE } from "@/lib/auth";

// Development-only helper for the EVA_AUTH_BYPASS flow: sets the role cookie
// that getSession reads to decide which account to impersonate, then bounces
// to that app's home. Disabled unless EVA_AUTH_BYPASS=1 and not production,
// so it can never be reached on a real deployment.
//
//   /api/dev/login-as?role=evaluator  -> act as an evaluator, go to /my
//   /api/dev/login-as?role=admin      -> act as admin, go to /dashboard
export async function GET(req: NextRequest) {
  if (process.env.EVA_AUTH_BYPASS !== "1" || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }

  const roleParam = req.nextUrl.searchParams.get("role")?.toUpperCase();
  const role = roleParam === "EVALUATOR" ? "EVALUATOR" : roleParam === "STUDENT" ? "STUDENT" : "ADMIN";
  const dest = role === "EVALUATOR" ? "/my" : role === "STUDENT" ? "/me" : "/dashboard";
  const res = NextResponse.redirect(new URL(dest, req.nextUrl.origin));
  res.cookies.set(DEV_ROLE_COOKIE, role, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}
