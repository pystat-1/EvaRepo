// End-to-end harness: the real desktop UI and the real phone app in
// Chromium, the real relay code in Node, no Tauri window and no network.
//   - Desktop: Vite dev server; Tauri's IPC is answered here from a SQLite
//     file (the same SQL the Rust side runs).
//   - Relay: apps/relay/src/relay.ts over in-memory SQLite (D1-shaped).
//   - Phone: the production build (vite preview, with its service worker);
//     Google's sign-in script is replaced by a stand-in whose ID tokens are
//     signed by a test key the relay trusts, so every relay check still runs.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { handle, type DB, type Env, type Stmt } from "../../relay/src/relay";
import { seeded } from "../../../packages/db/src/repo/testSeed";

export const ROOT = path.resolve(import.meta.dirname, "../../..");
export const RELAY = "https://eva-relay.evarepo.workers.dev"; // the desktop's default; intercepted, never reached
export const ADMIN = "e2e-admin-key-0123456789abcdef";
const CLIENT = "e2e.apps.googleusercontent.com";
export const log = (...a: unknown[]) => console.log(...a);

export async function waitFor(what: string, fn: () => Promise<boolean>, ms: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return Math.round((Date.now() - t0) / 1000);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out: ${what}`);
}

// ---- seed: the sample course, moved so it is running this week ----------------

const DAY = 86400_000;
export function sundayOnOrBefore(d = new Date()) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return new Date(x.getTime() - x.getUTCDay() * DAY).toISOString().slice(0, 10);
}

/** A database file with the sample course (6 groups x perGroup students), starting this week. */
export async function seedFile(file: string, perGroup: number) {
  for (const x of ["", "-wal", "-shm"]) fs.rmSync(file + x, { force: true });
  const r = await seeded(perGroup, file);
  const shift = Math.round((Date.parse(sundayOnOrBefore()) - Date.parse("2026-10-04")) / DAY);
  const mv = (col: string) => `${col} = date(${col}, '${shift >= 0 ? "+" : ""}${shift} days')`;
  r.raw.exec(`UPDATE rotation_blocks SET ${mv("startDate")}, ${mv("endDate")}; UPDATE courses SET ${mv("startDate")};`);
  // Evaluators' real-looking emails (the seed's are short test ones).
  r.raw.exec(`UPDATE accounts SET email = 'sara.e2e@gmail.com' WHERE id = 'e-sara'; UPDATE accounts SET email = 'ali.e2e@gmail.com' WHERE id = 'e-ali';`);
  return r.raw;
}

// ---- relay in Node --------------------------------------------------------------

export async function startRelay() {
  const db = new Database(":memory:");
  const dir = path.join(ROOT, "apps/relay/migrations");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  const stmt = (sql: string, values: unknown[] = []): Stmt & { exec(): unknown } => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    first: async <T,>() => (db.prepare(sql).get(...values) as T) ?? null,
    all: async <T,>() => ({ results: db.prepare(sql).all(...values) as T[] }),
    run: async () => db.prepare(sql).run(...values),
    exec: () => db.prepare(sql).run(...values),
  });
  const d1: DB = {
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => db.transaction(() => stmts.forEach((s) => (s as unknown as { exec(): unknown }).exec()))(),
  };
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const env: Env = { DB: d1, ADMIN_TOKEN: ADMIN, GOOGLE_CLIENT_ID: CLIENT, googleKeys: async (kid) => (kid === "k1" ? jwk : null) };

  async function serve(route: Route, origin: string) {
    const req = route.request();
    const cors = { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, PUT" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = req.url().replace(/^https?:\/\/[^/]+/, "https://relay.local");
    const body = req.postDataBuffer();
    const res = await handle(new Request(url, { method: req.method(), headers: req.headers(), body: body && req.method() !== "GET" ? new Uint8Array(body) : undefined }), env);
    const headers: Record<string, string> = { ...cors };
    res.headers.forEach((v, k) => (headers[k] = v));
    await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
  }

  const b64url = (b: Uint8Array | string) =>
    Buffer.from(typeof b === "string" ? new TextEncoder().encode(b) : b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  async function idToken(email: string, name: string) {
    const t = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
    const body = b64url(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT, iat: t, exp: t + 3600, email, email_verified: true, name, sub: email }));
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${head}.${body}`)));
    return `${head}.${body}.${b64url(sig)}`;
  }
  return { db, serve, idToken };
}
export type Relay = Awaited<ReturnType<typeof startRelay>>;

// ---- servers and browsers -----------------------------------------------------------

const servers: ChildProcess[] = [];
export function startVite(app: "desktop" | "evaluator", port: number, preview = false) {
  const p = spawn("npx", ["vite", ...(preview ? ["preview"] : []), "--port", String(port), "--strictPort"], { cwd: path.join(ROOT, "apps", app), shell: true });
  servers.push(p);
  return new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`vite ${app} did not start`)), 120_000);
    p.stdout!.on("data", (d) => String(d).includes("Local") && (clearTimeout(t), res()));
  });
}
export function stopServers() {
  for (const p of servers) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"]);
    else p.kill("SIGTERM");
  }
}

/** Tauri's IPC answered from a SQLite file (the commands the Rust side implements). */
function tauriCommands(db: Database.Database, file: string, out: string) {
  const bind = (p: unknown[] = []) => p.map((v) => (Array.isArray(v) ? Buffer.from(v as number[]) : v));
  type Args = { sql: string; params?: unknown[]; statements: Array<{ sql: string; params?: unknown[] }> };
  return (cmd: string, a: Args): unknown => {
    switch (cmd) {
      case "db_open": return { path: file, backups_dir: out, created: false };
      case "db_exec": db.exec(a.sql); return null;
      case "db_query": { const s = db.prepare(a.sql); return s.reader ? s.all(...bind(a.params)) : (s.run(...bind(a.params)), []); }
      case "db_values": { const s = db.prepare(a.sql); return s.reader ? s.raw().all(...bind(a.params)) : (s.run(...bind(a.params)), []); }
      case "db_run": return db.prepare(a.sql).run(...bind(a.params)).changes;
      case "db_batch": db.transaction(() => a.statements.forEach((s) => db.prepare(s.sql).run(...bind(s.params))))(); return null;
      case "db_integrity": return db.pragma("integrity_check", { simple: true });
      case "backup_list": return [{ name: `eva-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-080000-daily.db`, size: 1000 }];
      case "backup_create": return 1;
      case "system_info": return { version: "0.2.0", data_dir: out, log_dir: out, db_bytes: fs.statSync(file).size, wal_bytes: 0, free_disk_bytes: 50e9, os: "e2e" };
      case "log_tail": return "";
      case "plugin:updater|check": return null; // no update in tests
      default: return null;
    }
  };
}

const TAURI_SHIM = `
  let cb = 0;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback: () => ++cb,
    invoke: async (cmd, args) => {
      const r = await window.__evaNode(cmd, args);
      if (r.err) throw r.err;
      return r.ok;
    },
  };`;

export async function openDesktop(browser: Browser, db: Database.Database, file: string, out: string, relay?: Relay) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.length < 20 && errors.push("desktop: " + e.message));
  const run = tauriCommands(db, file, out);
  await page.exposeFunction("__evaNode", (cmd: string, args: Parameters<typeof run>[1] | undefined) => {
    try {
      return { ok: run(cmd, args ?? ({} as Parameters<typeof run>[1])) };
    } catch (e) {
      return { err: String((e as Error).message) };
    }
  });
  await page.addInitScript({ content: TAURI_SHIM });
  if (relay) await page.route(`${RELAY}/**`, (r) => relay.serve(r, "http://localhost:1420"));
  await page.goto("http://localhost:1420/");
  return { page, errors };
}

const FAKE_GSI = `
window.google = { accounts: { id: {
  initialize(o) { window.__gsi = o; },
  prompt() {},
  renderButton(el) {
    const b = document.createElement("button");
    b.id = "fake-google"; b.textContent = "Sign in with Google (test)";
    b.onclick = async () => window.__gsi.callback({ credential: await window.__fakeGoogleToken() });
    el.appendChild(b);
  },
} } };`;

export async function openPhone(browser: Browser, relay: Relay, account: { current: { email: string; name: string } }) {
  const { devices } = await import("playwright");
  const ctx: BrowserContext = await browser.newContext({ ...devices["Pixel 7"], locale: "ar" });
  await ctx.exposeFunction("__fakeGoogleToken", () => relay.idToken(account.current.email, account.current.name));
  await ctx.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ contentType: "text/javascript", body: FAKE_GSI }));
  await ctx.route("http://localhost:1430/api/**", (r) => relay.serve(r, "http://localhost:1430"));
  const page: Page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.length < 20 && errors.push("phone: " + e.message));
  await page.goto("http://localhost:1430/");
  return { ctx, page, errors };
}

export const launch = () => chromium.launch();
