// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { StringValue } from "ms";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { recordAudit } from "./audit";

// Fail loudly if JWT_SECRET is missing — never fall back to a hardcoded
// default. (This is the exact bug found and flagged in the PyoriLearn audit
// — a hardcoded fallback secret meant a misconfigured deployment silently
// ran insecurely. This module is written specifically not to repeat it.)
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not set. Refusing to start with an insecure default — set JWT_SECRET in your environment."
    );
  }
  return secret;
}

export const SESSION_COOKIE = "eva_session";

export type Role = "ADMIN" | "EVALUATOR" | "STUDENT";

export interface SessionPayload {
  sub: string; // account id
  email: string;
  name: string;
  role: Role;
  studentId?: string | null; // set only for STUDENT-role accounts
  // EVALUATOR_APP_PLAN.md §3/E2: the server-side Session row backing this
  // JWT, present only for EVALUATOR logins issued after this field was
  // added. Its absence (older tokens, or ADMIN/STUDENT logins, which this
  // step deliberately leaves on the original JWT-only flow) skips the DB
  // check in getSession() below — never rejected outright, so nobody with
  // a still-valid pre-existing cookie gets logged out by this change.
  sid?: string;
}

export interface AccountRow {
  id: string;
  email: string;
  passwordHash: string | null;
  name: string;
  role: Role;
  studentId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function serialize(row: {
  id: string;
  email: string;
  passwordHash: string | null;
  name: string;
  role: string;
  studentId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): AccountRow {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    name: row.name,
    role: row.role as Role,
    studentId: row.studentId,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// The old SQLite lookup used `COLLATE NOCASE` for a case-insensitive email
// match; Postgres text columns are case-sensitive by default, so this uses
// Prisma's `mode: "insensitive"` filter to preserve the same behavior.
export async function findAccountByEmail(email: string): Promise<AccountRow | undefined> {
  const row = await prisma.account.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  return row ? serialize(row) : undefined;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export function signSession(payload: SessionPayload, expiresIn: StringValue = "12h"): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as SessionPayload;
  } catch {
    return null;
  }
}

// EVALUATOR_APP_PLAN.md §3/E2: server-side sessions for evaluators, backing
// the JWT so an account can be cut off (deactivation, revoke) on the very
// next request instead of up to 12h later — the old JWT-only design's
// defect C7. The JWT's own expiry is set generously (see EVALUATOR_JWT_TTL
// below); this Session row, not the JWT, is what actually decides whether
// access continues.
export const EVALUATOR_SESSION_TTL_DAYS = 14;
const EVALUATOR_JWT_TTL: StringValue = "30d"; // safety-net upper bound; the Session row (14d sliding) is the real expiry

function evaluatorSessionExpiry(): Date {
  return new Date(Date.now() + EVALUATOR_SESSION_TTL_DAYS * 86_400_000);
}

export async function createEvaluatorSession(
  accountId: string,
  deviceLabel: string | null
): Promise<{ id: string }> {
  const session = await prisma.session.create({
    data: { accountId, deviceLabel, expiresAt: evaluatorSessionExpiry() },
  });
  return { id: session.id };
}

export function signEvaluatorSession(payload: SessionPayload): string {
  return signSession(payload, EVALUATOR_JWT_TTL);
}

// Validates AND slides an evaluator's server-side session in one query —
// called on every request that carries a `sid` (see getSession below).
// Any of these ends the session immediately: revoked, past its sliding
// expiry, the session row itself gone, or the account deactivated.
export async function touchEvaluatorSession(sessionId: string, accountId: string): Promise<boolean> {
  const now = new Date();
  const [session, account] = await Promise.all([
    prisma.session.findUnique({ where: { id: sessionId } }),
    prisma.account.findUnique({ where: { id: accountId }, select: { active: true } }),
  ]);
  if (!session || session.accountId !== accountId) return false;
  if (session.revokedAt) return false;
  if (session.expiresAt <= now) return false;
  if (!account?.active) return false;

  await prisma.session.update({
    where: { id: sessionId },
    data: { lastSeenAt: now, expiresAt: evaluatorSessionExpiry() },
  });
  return true;
}

export async function revokeSession(actorId: string, sessionId: string): Promise<void> {
  await prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  await recordAudit({ actorId, entityType: "Session", entityId: sessionId, action: "deactivate" });
}

export interface SessionRow {
  id: string;
  accountId: string;
  accountName: string;
  accountEmail: string;
  deviceLabel: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

// For the admin Sessions page (plan §4): every non-revoked, unexpired
// session for evaluator accounts, most recently active first.
export async function listActiveEvaluatorSessions(): Promise<SessionRow[]> {
  const rows = await prisma.session.findMany({
    where: {
      revokedAt: null,
      expiresAt: { gt: new Date() },
      account: { role: "EVALUATOR" },
    },
    orderBy: { lastSeenAt: "desc" },
    include: { account: { select: { name: true, email: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    accountName: r.account.name,
    accountEmail: r.account.email,
    deviceLabel: r.deviceLabel,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
  }));
}

// Development-only login bypass. When EVA_AUTH_BYPASS=1, requests with no
// valid session fall back to acting as a real account — the first active
// admin by default, or the first active evaluator when the `eva_dev_role`
// cookie is set to "EVALUATOR" (see /api/dev/login-as). Lets you test both
// apps without credentials. Deliberately IGNORED when NODE_ENV ===
// "production", so it can never make a deployed instance passwordless even
// if the flag leaks into that env. Flip the env var off to restore login.
export const DEV_ROLE_COOKIE = "eva_dev_role";

// Cache the impersonated session per role so we don't re-query every call.
const bypassSessionCache = new Map<"ADMIN" | "EVALUATOR" | "STUDENT", SessionPayload | null>();

async function devBypassSession(role: "ADMIN" | "EVALUATOR" | "STUDENT"): Promise<SessionPayload | null> {
  if (process.env.EVA_AUTH_BYPASS !== "1" || process.env.NODE_ENV === "production") {
    return null;
  }
  const cached = bypassSessionCache.get(role);
  if (cached !== undefined) return cached;

  let session: SessionPayload | null = null;
  if (role === "EVALUATOR") {
    // Prefer an evaluator that actually has an active assignment, so the
    // schedule and roster views have something to show.
    const assignment = await prisma.evaluatorAssignment.findFirst({
      where: { active: true, account: { active: true, role: "EVALUATOR" } },
      include: { account: true },
    });
    const acct = assignment?.account ?? (await prisma.account.findFirst({ where: { role: "EVALUATOR", active: true } }));
    if (acct) session = { sub: acct.id, email: acct.email, name: acct.name, role: "EVALUATOR" };
  } else if (role === "STUDENT") {
    const acct = await prisma.account.findFirst({ where: { role: "STUDENT", active: true, studentId: { not: null } } });
    if (acct) session = { sub: acct.id, email: acct.email, name: acct.name, role: "STUDENT", studentId: acct.studentId };
  } else {
    const admin = await prisma.account.findFirst({ where: { role: "ADMIN", active: true } });
    if (admin) session = { sub: admin.id, email: admin.email, name: admin.name, role: "ADMIN" };
  }

  bypassSessionCache.set(role, session);
  if (session) {
    console.warn(`⚠️  EVA_AUTH_BYPASS active — running as ${role} (${session.email}). Do not use in production.`);
  } else {
    console.warn(`⚠️  EVA_AUTH_BYPASS is set but no active ${role} account exists to impersonate.`);
  }
  return session;
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const session = verifySession(token);
    if (session) {
      if (session.role === "EVALUATOR" && session.sid) {
        const stillValid = await touchEvaluatorSession(session.sid, session.sub);
        if (!stillValid) return null;
      }
      return session;
    }
  }
  const roleCookie = store.get(DEV_ROLE_COOKIE)?.value;
  const role = roleCookie === "EVALUATOR" ? "EVALUATOR" : roleCookie === "STUDENT" ? "STUDENT" : "ADMIN";
  return devBypassSession(role);
}

export async function requireRole(...roles: Role[]): Promise<SessionPayload> {
  const session = await getSession();
  if (!session || !roles.includes(session.role)) {
    throw new AuthError(session ? "forbidden" : "unauthenticated");
  }
  return session;
}

// A short, human-readable label for the admin Sessions page — not meant to
// be a precise UA parse, just enough for "which of my devices is this."
export function deviceLabelFromUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const os = /android/i.test(ua)
    ? "Android"
    : /iphone|ipad/i.test(ua)
      ? "iOS"
      : /windows/i.test(ua)
        ? "Windows"
        : /mac os/i.test(ua)
          ? "Mac"
          : "جهاز";
  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /chrome\//i.test(ua)
      ? "Chrome"
      : /firefox\//i.test(ua)
        ? "Firefox"
        : /safari\//i.test(ua)
          ? "Safari"
          : "متصفح";
  return `${browser} · ${os}`;
}

export class AuthError extends Error {
  code: "unauthenticated" | "forbidden";
  constructor(code: "unauthenticated" | "forbidden") {
    super(code);
    this.code = code;
  }
}
