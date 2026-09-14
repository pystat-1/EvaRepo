// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { prisma } from "./db";

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

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "12h" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function requireRole(...roles: Role[]): Promise<SessionPayload> {
  const session = await getSession();
  if (!session || !roles.includes(session.role)) {
    throw new AuthError(session ? "forbidden" : "unauthenticated");
  }
  return session;
}

export class AuthError extends Error {
  code: "unauthenticated" | "forbidden";
  constructor(code: "unauthenticated" | "forbidden") {
    super(code);
    this.code = code;
  }
}
