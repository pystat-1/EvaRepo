// Eva relay logic: a mailbox between Eva Desktop (admin) and evaluator
// phones (docs/adr/0002). Written against a tiny D1-shaped interface so it
// is tested with real SQLite in Node and runs unchanged on Cloudflare.
// Every handler does a few indexed queries: a few ms of CPU.
import { checkDaySubmission, type DaySubmission, type EvaluatorBundle, type SubmissionResult } from "@eva/core/sync/contract";
import { randomToken, sha256Hex } from "@eva/core/sync/tokens";
import { GoogleTokenError, googleKeys, verifyGoogleIdToken, type KeyLookup } from "./google";

export interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface DB {
  prepare(sql: string): Stmt;
  batch(stmts: Stmt[]): Promise<unknown>;
}
export interface Env {
  DB: DB;
  ADMIN_TOKEN: string;
  /** Google OAuth web client ID (public). Unset = phone sign-in is off. */
  GOOGLE_CLIENT_ID?: string;
  /** Tests pass their own signing keys; production uses Google's. */
  googleKeys?: KeyLookup;
  /** R2 bucket for the desktop's encrypted backups (optional: off when absent). */
  BACKUPS?: BackupBucket;
}

/** The slice of Cloudflare R2 used for backups (also faked in tests). */
export interface BackupBucket {
  put(key: string, value: ArrayBuffer | ReadableStream | null, opts?: { customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
  list(opts?: { prefix?: string; cursor?: string }): Promise<{ objects: Array<{ key: string; size: number; uploaded: Date }>; truncated: boolean; cursor?: string }>;
  delete(key: string): Promise<void>;
}

const SESSION_DAYS = 90; // sliding: an evaluator who uses the app never has to sign in again
const MAX_SUBMISSIONS_PER_CALL = 20;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fail = (status: number, error: string) => json({ error }, status);
const now = () => new Date();
const iso = (d: Date) => d.toISOString();

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function readJson<T>(req: Request, maxBytes = 2_000_000): Promise<T | null> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) return null;
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

// ---- evaluator (phone) ----------------------------------------------------

async function session(env: Env, req: Request): Promise<{ evaluatorId: string } | null> {
  const token = bearer(req);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.evaluatorId, s.expiresAt, e.active FROM sessions s JOIN evaluators e ON e.id = s.evaluatorId WHERE s.tokenHash = ?`
  )
    .bind(hash)
    .first<{ evaluatorId: string; expiresAt: string; active: number }>();
  if (!row || !row.active || row.expiresAt < iso(now())) return null;
  // Sliding expiry, refreshed at most once a day to keep writes low.
  const fresh = iso(new Date(now().getTime() + SESSION_DAYS * 86400_000));
  if (fresh.slice(0, 10) !== row.expiresAt.slice(0, 10)) {
    await env.DB.prepare(`UPDATE sessions SET lastSeenAt = ?, expiresAt = ? WHERE tokenHash = ?`).bind(iso(now()), fresh, hash).run();
  }
  return { evaluatorId: row.evaluatorId };
}

function config(env: Env) {
  return json({ googleClientId: env.GOOGLE_CLIENT_ID || null });
}

// The phone sends the ID token Google gave it; the email in it must be an
// active evaluator's. The session token that comes back is the phone's key.
async function loginGoogle(env: Env, req: Request) {
  if (!env.GOOGLE_CLIENT_ID) return fail(503, "الدخول بحساب Google غير مفعَّل بعد — تواصل مع المدير");
  const body = await readJson<{ credential?: string }>(req, 20_000);
  const credential = String(body?.credential ?? "");
  if (!credential) return fail(400, "طلب غير صالح");
  let who;
  try {
    who = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID, env.googleKeys ?? googleKeys);
  } catch (e) {
    if (e instanceof GoogleTokenError) return fail(401, e.message);
    throw e;
  }
  const ev = await env.DB.prepare(`SELECT id, name, active FROM evaluators WHERE email = ?`)
    .bind(who.email)
    .first<{ id: string; name: string; active: number }>();
  if (!ev || !ev.active) return fail(403, `الحساب ${who.email} غير مسجَّل كمقيّم — اطلب من المدير إضافة هذا البريد`);
  const t = now();
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sessions (tokenHash, evaluatorId, createdAt, lastSeenAt, expiresAt) VALUES (?, ?, ?, ?, ?)`).bind(
      await sha256Hex(token), ev.id, iso(t), iso(t), iso(new Date(t.getTime() + SESSION_DAYS * 86400_000))
    ),
    env.DB.prepare(`UPDATE evaluators SET googleName = ?, lastLoginAt = ? WHERE id = ?`).bind(who.name, iso(t), ev.id),
  ]);
  return json({ token, evaluator: { id: ev.id, name: ev.name }, email: who.email });
}

async function logout(env: Env, req: Request) {
  const token = bearer(req);
  if (token) await env.DB.prepare(`DELETE FROM sessions WHERE tokenHash = ?`).bind(await sha256Hex(token)).run();
  return json({ ok: true });
}

async function getBundle(env: Env, req: Request, who: { evaluatorId: string }) {
  const row = await env.DB.prepare(`SELECT version, json FROM bundles WHERE evaluatorId = ?`).bind(who.evaluatorId).first<{ version: string; json: string }>();
  if (!row) return fail(404, "لم يُنشر لك جدول بعد — تواصل مع المدير");
  if (req.headers.get("if-none-match") === row.version) return new Response(null, { status: 304 });
  return new Response(row.json, { headers: { "content-type": "application/json; charset=utf-8", etag: row.version, "cache-control": "no-store" } });
}

async function postSubmissions(env: Env, req: Request, who: { evaluatorId: string }) {
  const body = await readJson<{ submissions?: unknown[] }>(req);
  const list = Array.isArray(body?.submissions) ? body!.submissions : null;
  if (!list || list.length === 0 || list.length > MAX_SUBMISSIONS_PER_CALL) return fail(400, "طلب غير صالح");
  const accepted: string[] = [];
  const rejected: Array<{ clientId: string; message: string }> = [];
  const stmts: Stmt[] = [];
  for (const raw of list) {
    // The evaluator is always the session's, whatever the phone sent.
    const sub = { ...(raw as object), evaluatorId: who.evaluatorId } as DaySubmission;
    const problem = checkDaySubmission(sub);
    if (problem) {
      rejected.push({ clientId: String((raw as { clientId?: unknown })?.clientId ?? ""), message: problem });
      continue;
    }
    stmts.push(
      env.DB.prepare(
        `INSERT INTO submissions (clientId, evaluatorId, groupId, dateISO, payload, receivedAt) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(clientId) DO NOTHING`
      ).bind(sub.clientId, sub.evaluatorId, sub.groupId, sub.dateISO, JSON.stringify(sub), iso(now()))
    );
    accepted.push(sub.clientId); // already-received ids are accepted too (idempotent)
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ accepted, rejected });
}

async function getResults(env: Env, who: { evaluatorId: string }) {
  const { results } = await env.DB.prepare(
    `SELECT clientId, outcome, message, decidedAt FROM results WHERE evaluatorId = ? ORDER BY decidedAt DESC LIMIT 300`
  )
    .bind(who.evaluatorId)
    .all();
  return json({ results });
}

// ---- admin (Eva Desktop) --------------------------------------------------

interface PublishBody {
  evaluators: Array<{ id: string; email: string; name: string; active: boolean }>;
  bundles: EvaluatorBundle[];
}

async function publish(env: Env, req: Request) {
  const body = await readJson<PublishBody>(req, 20_000_000);
  if (!body || !Array.isArray(body.evaluators) || !Array.isArray(body.bundles)) return fail(400, "طلب غير صالح");
  const stamp = iso(now());
  const before = await env.DB.prepare(`SELECT id, email, active FROM evaluators`).all<{ id: string; email: string; active: number }>();
  const prev = new Map(before.results.map((e) => [e.id, e]));
  const stmts: Stmt[] = [];
  // Emails are unique here, and one can move to another evaluator (removed and
  // re-added on the desktop, or two swapped): release every email that is
  // leaving its row before any row takes one.
  const next = new Map(body.evaluators.map((e) => [e.id, String(e.email ?? "").toLowerCase()]));
  for (const p of before.results) {
    if (next.get(p.id) !== p.email) stmts.push(env.DB.prepare(`UPDATE evaluators SET email = '#' || id WHERE id = ?`).bind(p.id));
  }
  const listed = new Set<string>();
  for (const e of body.evaluators) {
    listed.add(e.id);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO evaluators (id, email, name, active, updatedAt) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, active = excluded.active, updatedAt = excluded.updatedAt`
      ).bind(e.id, e.email.toLowerCase(), e.name, e.active ? 1 : 0, stamp)
    );
    const p = prev.get(e.id);
    // Deactivation or a changed email signs the evaluator out everywhere.
    if (p && (!e.active || p.email !== e.email.toLowerCase())) {
      stmts.push(env.DB.prepare(`DELETE FROM sessions WHERE evaluatorId = ?`).bind(e.id));
      if (p.email !== e.email.toLowerCase()) stmts.push(env.DB.prepare(`UPDATE evaluators SET googleName = NULL, lastLoginAt = NULL WHERE id = ?`).bind(e.id));
    }
  }
  for (const p of before.results) {
    if (!listed.has(p.id)) {
      stmts.push(env.DB.prepare(`UPDATE evaluators SET active = 0, updatedAt = ? WHERE id = ?`).bind(stamp, p.id));
      stmts.push(env.DB.prepare(`DELETE FROM sessions WHERE evaluatorId = ?`).bind(p.id));
    }
  }
  const withBundle = new Set<string>();
  for (const b of body.bundles) {
    withBundle.add(b.evaluator.id);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO bundles (evaluatorId, version, json, updatedAt) VALUES (?, ?, ?, ?)
         ON CONFLICT(evaluatorId) DO UPDATE SET version = excluded.version, json = excluded.json, updatedAt = excluded.updatedAt`
      ).bind(b.evaluator.id, b.version, JSON.stringify(b), stamp)
    );
  }
  const existing = await env.DB.prepare(`SELECT evaluatorId FROM bundles`).all<{ evaluatorId: string }>();
  for (const x of existing.results) if (!withBundle.has(x.evaluatorId)) stmts.push(env.DB.prepare(`DELETE FROM bundles WHERE evaluatorId = ?`).bind(x.evaluatorId));
  await env.DB.batch(stmts);
  return json({ ok: true, evaluators: body.evaluators.length, bundles: body.bundles.length });
}

async function listSubmissions(env: Env, url: URL) {
  const after = Math.max(0, Number(url.searchParams.get("after") ?? 0) || 0);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));
  const { results } = await env.DB.prepare(`SELECT seq, payload, receivedAt FROM submissions WHERE seq > ? ORDER BY seq LIMIT ?`)
    .bind(after, limit)
    .all<{ seq: number; payload: string; receivedAt: string }>();
  return json({ submissions: results.map((r) => ({ seq: r.seq, receivedAt: r.receivedAt, submission: JSON.parse(r.payload) })) });
}

async function postResults(env: Env, req: Request) {
  const body = await readJson<{ results?: SubmissionResult[] }>(req);
  if (!Array.isArray(body?.results)) return fail(400, "طلب غير صالح");
  const stamp = iso(now());
  const stmts = body!.results.map((r) =>
    env.DB.prepare(
      `INSERT INTO results (clientId, evaluatorId, outcome, message, decidedAt)
       SELECT ?, evaluatorId, ?, ?, ? FROM submissions WHERE clientId = ?
       ON CONFLICT(clientId) DO UPDATE SET outcome = excluded.outcome, message = excluded.message, decidedAt = excluded.decidedAt`
    ).bind(r.clientId, r.outcome, String(r.message).slice(0, 500), stamp, r.clientId)
  );
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, count: stmts.length });
}

async function status(env: Env) {
  const q = (sql: string) => env.DB.prepare(sql).first<{ n: number }>().then((r) => r?.n ?? 0);
  return json({
    evaluators: await q(`SELECT COUNT(*) AS n FROM evaluators WHERE active = 1`),
    bundles: await q(`SELECT COUNT(*) AS n FROM bundles`),
    submissions: await q(`SELECT COUNT(*) AS n FROM submissions`),
    lastSeq: await q(`SELECT COALESCE(MAX(seq), 0) AS n FROM submissions`),
    googleSignIn: !!env.GOOGLE_CLIENT_ID,
    backups: !!env.BACKUPS,
    // Who has signed in on a phone, and when the phone was last active.
    phones: (
      await env.DB.prepare(
        `SELECT e.id, e.googleName, e.lastLoginAt, MAX(s.lastSeenAt) AS lastSeenAt
         FROM evaluators e LEFT JOIN sessions s ON s.evaluatorId = e.id
         WHERE e.lastLoginAt IS NOT NULL GROUP BY e.id`
      ).all<{ id: string; googleName: string | null; lastLoginAt: string; lastSeenAt: string | null }>()
    ).results,
  });
}

// ---- backups (admin) -------------------------------------------------------
// The desktop encrypts each backup before it leaves the laptop; the relay only
// stores the opaque files. Names mirror the local backup names.

const BACKUP_NAME = /^eva-\d{8}-\d{6}-[a-z-]{3,20}\.db\.evab$/;
const MAX_BACKUP_BYTES = 95 * 1024 * 1024; // under the Workers request limit

async function listBackups(env: Env) {
  const out: Array<{ name: string; size: number; uploadedAt: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await env.BACKUPS!.list({ prefix: "eva-", cursor });
    for (const o of page.objects) if (BACKUP_NAME.test(o.key)) out.push({ name: o.key, size: o.size, uploadedAt: o.uploaded.toISOString() });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return json({ backups: out.sort((a, b) => b.name.localeCompare(a.name)) });
}

async function backupFile(env: Env, req: Request, name: string) {
  if (!BACKUP_NAME.test(name)) return fail(400, "اسم نسخة غير صالح");
  if (req.method === "PUT") {
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BACKUP_BYTES) return fail(413, "حجم النسخة غير مقبول");
    const body = await req.arrayBuffer(); // the size that arrived is what counts
    if (!body.byteLength || body.byteLength > MAX_BACKUP_BYTES) return fail(413, "حجم النسخة غير مقبول");
    if (new TextDecoder().decode(body.slice(0, 4)) !== "EVAB") return fail(400, "ملف نسخة غير صالح");
    await env.BACKUPS!.put(name, body);
    return json({ ok: true, name, size: body.byteLength });
  }
  if (req.method === "GET") {
    const obj = await env.BACKUPS!.get(name);
    if (!obj) return fail(404, "النسخة غير موجودة");
    return new Response(obj.body, { headers: { "content-type": "application/octet-stream", "content-length": String(obj.size), "cache-control": "no-store" } });
  }
  if (req.method === "DELETE") {
    await env.BACKUPS!.delete(name);
    return json({ ok: true });
  }
  return fail(405, "غير مسموح");
}

// ---- routing ----------------------------------------------------------------

// Eva Desktop's pages come from the Tauri webview origin, so the admin API
// allows exactly those origins (CORS). The phone app is same-origin.
const DESKTOP_ORIGINS = new Set(["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"]);

function withCors(res: Response, origin: string | null): Response {
  if (!origin || !DESKTOP_ORIGINS.has(origin)) return res;
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", origin);
  h.set("vary", "origin");
  return new Response(res.body, { status: res.status, headers: h });
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const origin = req.headers.get("origin");
  const p = new URL(req.url).pathname;
  if (req.method === "OPTIONS" && p.startsWith("/admin/")) {
    if (!origin || !DESKTOP_ORIGINS.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, PUT, DELETE",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-max-age": "86400",
        vary: "origin",
      },
    });
  }
  const res = await route(req, env);
  return p.startsWith("/admin/") ? withCors(res, origin) : res;
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  try {
    if (p.startsWith("/admin/")) {
      const token = bearer(req);
      if (!env.ADMIN_TOKEN || !token || !safeEqual(token, env.ADMIN_TOKEN)) return fail(401, "مفتاح المدير غير صحيح");
      if (p === "/admin/publish" && req.method === "PUT") return await publish(env, req);
      if (p === "/admin/submissions" && req.method === "GET") return await listSubmissions(env, url);
      if (p === "/admin/results" && req.method === "POST") return await postResults(env, req);
      if (p === "/admin/status" && req.method === "GET") return await status(env);
      if (p === "/admin/backups" || p.startsWith("/admin/backups/")) {
        if (!env.BACKUPS) return fail(503, "التخزين على الإنترنت غير مفعَّل على الخادم");
        if (p === "/admin/backups" && req.method === "GET") return await listBackups(env);
        return await backupFile(env, req, decodeURIComponent(p.slice("/admin/backups/".length)));
      }
      return fail(404, "غير موجود");
    }
    if (p === "/api/config" && req.method === "GET") return config(env);
    if (p === "/api/login/google" && req.method === "POST") return await loginGoogle(env, req);
    if (p === "/api/logout" && req.method === "POST") return await logout(env, req);
    if (p.startsWith("/api/")) {
      const who = await session(env, req);
      if (!who) return fail(401, "انتهت الجلسة — سجّل الدخول");
      if (p === "/api/bundle" && req.method === "GET") return await getBundle(env, req, who);
      if (p === "/api/submissions" && req.method === "POST") return await postSubmissions(env, req, who);
      if (p === "/api/results" && req.method === "GET") return await getResults(env, who);
      return fail(404, "غير موجود");
    }
    return fail(404, "غير موجود");
  } catch (e) {
    console.error("relay error", p, e);
    return fail(500, "خطأ في الخادم — حاول لاحقًا");
  }
}
