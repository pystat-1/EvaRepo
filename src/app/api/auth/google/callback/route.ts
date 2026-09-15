import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { signSession, SESSION_COOKIE } from "@/lib/auth";

const STATE_COOKIE = "google_oauth_state";

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

function loginRedirect(req: NextRequest, error: string): NextResponse {
  const url = new URL("/login", req.nextUrl.origin);
  url.searchParams.set("google_error", error);
  return NextResponse.redirect(url);
}

// Google login only ever signs in to an EXISTING account (matched by
// email) — it never creates one. Accounts are still provisioned by an
// admin from the admin panel; Google Sign-In just becomes another way to
// authenticate into an account that already exists, linked on first
// successful sign-in. This preserves the current admin-provisioned
// account model instead of letting any Google account self-register.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;

  if (!code || !state || !cookieState || state !== cookieState) {
    return loginRedirect(req, "invalid_state");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return loginRedirect(req, "not_configured");
  }

  const redirectUri = `${req.nextUrl.origin}/api/auth/google/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    return loginRedirect(req, "token_exchange_failed");
  }
  const tokens = (await tokenRes.json()) as GoogleTokenResponse;

  const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) {
    return loginRedirect(req, "userinfo_failed");
  }
  const googleUser = (await userRes.json()) as GoogleUserInfo;

  if (!googleUser.email || !googleUser.email_verified) {
    return loginRedirect(req, "email_not_verified");
  }

  // Find by googleId first (already linked), then fall back to matching
  // an existing account by email (first-time link).
  let account = await prisma.account.findUnique({ where: { googleId: googleUser.sub } });
  if (!account) {
    const byEmail = await prisma.account.findFirst({
      where: { email: { equals: googleUser.email, mode: "insensitive" } },
    });
    if (!byEmail) {
      return loginRedirect(req, "no_matching_account");
    }
    if (byEmail.googleId && byEmail.googleId !== googleUser.sub) {
      // Email matches but is already linked to a different Google account.
      return loginRedirect(req, "account_linked_elsewhere");
    }
    account = await prisma.account.update({
      where: { id: byEmail.id },
      data: { googleId: googleUser.sub },
    });
  }

  if (!account.active) {
    return loginRedirect(req, "account_inactive");
  }

  const token = signSession({
    sub: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
    studentId: account.studentId ?? undefined,
  });

  const destination =
    account.role === "ADMIN" ? "/dashboard" : account.role === "EVALUATOR" ? "/my" : "/me";
  const res = NextResponse.redirect(new URL(destination, req.nextUrl.origin));
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  res.cookies.delete(STATE_COOKIE);
  return res;
}
