import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const STATE_COOKIE = "google_oauth_state";

// Starts the Google Sign-In flow. Google's redirect_uri must exactly match
// what's registered on the OAuth client in Google Cloud Console.
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "Google Sign-In is not configured" }, { status: 500 });
  }

  const state = crypto.randomBytes(24).toString("hex");
  const redirectUri = `${req.nextUrl.origin}/api/auth/google/callback`;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  return res;
}
