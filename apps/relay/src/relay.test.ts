import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import Database from "better-sqlite3";
import type { EvaluatorBundle } from "@eva/core/sync/contract";
import { handle, type BackupBucket, type DB, type Env, type Stmt } from "./relay";

// D1-shaped adapter over better-sqlite3 (D1 is SQLite, same SQL).
function d1(): DB {
  const db = new Database(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  const stmt = (sql: string, values: unknown[] = []): Stmt & { exec(): unknown } => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    first: async <T,>() => (db.prepare(sql).get(...values) as T) ?? null,
    all: async <T,>() => ({ results: db.prepare(sql).all(...values) as T[] }),
    run: async () => db.prepare(sql).run(...values),
    exec: () => db.prepare(sql).run(...values),
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => db.transaction(() => stmts.forEach((s) => (s as unknown as { exec(): unknown }).exec()))(),
  };
}

const ADMIN = "admin-secret-token";
let env: Env;
const call = (path: string, init: RequestInit & { token?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.body) headers.set("content-type", "application/json");
  return handle(new Request(`https://relay.test${path}`, { ...init, headers }), env);
};
const body = async (res: Response) => (await res.json()) as Record<string, unknown>;

const bundle = (evaluatorId: string, version = "v1"): EvaluatorBundle => ({
  format: 1, version, generatedAt: "t", evaluator: { id: evaluatorId, name: "د. سارة" },
  course: { id: "c1", label: "دورة", startDate: "2026-10-04" }, hospitals: [], groups: [], stints: [], rubric: [],
});
const day = (clientId: string, evaluatorId = "spoofed") => ({
  clientId, kind: "day", evaluatorId, groupId: "g1", dateISO: "2026-10-04", bundleVersion: "v1", validatedAt: "t",
  records: [{ studentId: "s1", attendance: "present", dailyNote: true, scores: { i1: 3 } }],
});

// A stand-in for Google: our own RSA key signs ID tokens exactly as Google does.
const CLIENT = "123-test.apps.googleusercontent.com";
let signer: CryptoKey;
let publicJwk: JsonWebKey;
const b64url = (b: Uint8Array | string) =>
  Buffer.from(typeof b === "string" ? new TextEncoder().encode(b) : b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function idToken(claims: Record<string, unknown>, kid = "k1") {
  const t = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT, iat: t, exp: t + 3600, email_verified: true, sub: "1", ...claims }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

async function publishSara(active = true, email = "Sara@X.iq") {
  return call("/admin/publish", {
    method: "PUT", token: ADMIN,
    body: JSON.stringify({ evaluators: [{ id: "e1", email, name: "د. سارة", active }], bundles: active ? [bundle("e1")] : [] }),
  });
}
async function googleLogin(claims: Record<string, unknown> = { email: "sara@x.iq", name: "Sara K" }, kid?: string) {
  return call("/api/login/google", { method: "POST", body: JSON.stringify({ credential: await idToken(claims, kid) }) });
}
async function loginSara() {
  return (await body(await googleLogin())) as { token: string };
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  signer = pair.privateKey;
  publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
});

describe("relay", () => {
  beforeEach(() => {
    env = { DB: d1(), ADMIN_TOKEN: ADMIN, GOOGLE_CLIENT_ID: CLIENT, googleKeys: async (kid) => (kid === "k1" ? publicJwk : null) };
  });

  it("admin endpoints need the admin key", async () => {
    expect((await call("/admin/status")).status).toBe(401);
    expect((await call("/admin/status", { token: "wrong" })).status).toBe(401);
    expect((await call("/admin/status", { token: ADMIN })).status).toBe(200);
  });

  it("Google sign-in: a registered evaluator's verified Google account gets a session", async () => {
    await publishSara();
    expect(await body(await call("/api/config"))).toEqual({ googleClientId: CLIENT });
    const res = await googleLogin({ email: "SARA@x.iq", name: "Sara K" });
    expect(res.status).toBe(200);
    const ok = await body(res);
    expect(ok.evaluator).toEqual({ id: "e1", name: "د. سارة" });
    expect(typeof ok.token).toBe("string");
    const status = (await body(await call("/admin/status", { token: ADMIN }))) as { phones: Array<{ id: string; googleName: string }>; googleSignIn: boolean };
    expect(status.googleSignIn).toBe(true);
    expect(status.phones).toMatchObject([{ id: "e1", googleName: "Sara K" }]);
  });

  it("Google sign-in refuses unknown emails and bad tokens", async () => {
    await publishSara();
    expect((await googleLogin({ email: "someone@gmail.com" })).status).toBe(403);
    expect((await googleLogin({ email: "sara@x.iq", aud: "other-app" })).status).toBe(401);
    expect((await googleLogin({ email: "sara@x.iq", iss: "https://evil.example" })).status).toBe(401);
    expect((await googleLogin({ email: "sara@x.iq", exp: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
    expect((await googleLogin({ email: "sara@x.iq", email_verified: false })).status).toBe(401);
    expect((await googleLogin({ email: "sara@x.iq" }, "unknown-kid")).status).toBe(401);
    const good = await idToken({ email: "sara@x.iq" });
    const [h, , sig] = good.split(".");
    const forged = `${h}.${b64url(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT, exp: 9e9, email: "sara@x.iq", email_verified: true }))}.${sig}`;
    expect((await call("/api/login/google", { method: "POST", body: JSON.stringify({ credential: forged }) })).status).toBe(401);
    env.GOOGLE_CLIENT_ID = undefined;
    expect((await googleLogin()).status).toBe(503);
  });

  it("serves the evaluator's bundle, with 304 when unchanged", async () => {
    await publishSara();
    const { token } = await loginSara();
    const res = await call("/api/bundle", { token });
    expect(res.status).toBe(200);
    expect(((await res.json()) as EvaluatorBundle).evaluator.id).toBe("e1");
    expect((await call("/api/bundle", { token, headers: { "if-none-match": "v1" } })).status).toBe(304);
    expect((await call("/api/bundle")).status).toBe(401);
  });

  it("stores submissions under the session's evaluator, idempotently", async () => {
    await publishSara();
    const { token } = await loginSara();
    const first = await body(await call("/api/submissions", { method: "POST", token, body: JSON.stringify({ submissions: [day("a"), { ...day("b"), dateISO: "bad" }] }) }));
    expect(first).toEqual({ accepted: ["a"], rejected: [{ clientId: "b", message: "تاريخ غير صالح" }] });
    await call("/api/submissions", { method: "POST", token, body: JSON.stringify({ submissions: [day("a")] }) }); // resend
    const listed = (await body(await call("/admin/submissions?after=0", { token: ADMIN }))) as { submissions: Array<{ seq: number; submission: { clientId: string; evaluatorId: string } }> };
    expect(listed.submissions).toHaveLength(1);
    expect(listed.submissions[0].submission).toMatchObject({ clientId: "a", evaluatorId: "e1" }); // not "spoofed"
    expect((await body(await call(`/admin/submissions?after=${listed.submissions[0].seq}`, { token: ADMIN }))).submissions).toEqual([]);
  });

  it("returns the desktop's decisions to the phone", async () => {
    await publishSara();
    const { token } = await loginSara();
    await call("/api/submissions", { method: "POST", token, body: JSON.stringify({ submissions: [day("a")] }) });
    await call("/admin/results", { method: "POST", token: ADMIN, body: JSON.stringify({ results: [{ clientId: "a", outcome: "applied", message: "اعتُمد 1 تقييم" }] }) });
    const { results } = (await body(await call("/api/results", { token }))) as { results: Array<{ clientId: string; outcome: string }> };
    expect(results).toMatchObject([{ clientId: "a", outcome: "applied" }]);
  });

  it("deactivation or a changed email signs the evaluator out", async () => {
    await publishSara();
    let { token } = await loginSara();
    await publishSara(true, "sara.new@x.iq");
    expect((await call("/api/bundle", { token })).status).toBe(401);
    expect((await googleLogin({ email: "sara@x.iq" })).status).toBe(403);
    expect((await googleLogin({ email: "sara.new@x.iq" })).status).toBe(200);
    ({ token } = (await body(await googleLogin({ email: "sara.new@x.iq" }))) as { token: string });
    await publishSara(false, "sara.new@x.iq");
    expect((await call("/api/bundle", { token })).status).toBe(401);
    expect((await googleLogin({ email: "sara.new@x.iq" })).status).toBe(403);
  });

  it("allows the desktop app's origin (CORS) on admin endpoints only", async () => {
    const pre = await call("/admin/status", { method: "OPTIONS", headers: { origin: "http://tauri.localhost" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
    expect((await call("/admin/status", { method: "OPTIONS", headers: { origin: "https://evil.example" } })).status).toBe(403);
    const res = await call("/admin/status", { token: ADMIN, headers: { origin: "http://tauri.localhost" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
  });

  it("stores, lists, returns and deletes encrypted backups (admin only)", async () => {
    const store = new Map<string, Uint8Array>();
    const bucket: BackupBucket = {
      put: async (k, v) => void store.set(k, new Uint8Array(v as ArrayBuffer)),
      get: async (k) => (store.has(k) ? { body: new Response(store.get(k)!).body!, size: store.get(k)!.length } : null),
      list: async () => ({ objects: [...store].map(([key, v]) => ({ key, size: v.length, uploaded: new Date("2026-10-01T00:00:00Z") })), truncated: false }),
      delete: async (k) => void store.delete(k),
    };
    env.BACKUPS = bucket;
    const name = "eva-20261001-080000-daily.db.evab";
    const file = new Uint8Array([...new TextEncoder().encode("EVAB"), 1, 2, 3]);
    const put = (n: string, body: Uint8Array, token = ADMIN) =>
      handle(new Request(`https://relay.test/admin/backups/${n}`, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-length": String(body.length) }, body }), env);
    expect((await put(name, file, "wrong")).status).toBe(401);
    expect((await put("evil.db.evab", file)).status).toBe(400); // only Eva backup names
    expect((await put("../../etc", file)).status).toBe(404); // paths never leave /admin/backups
    expect((await put(name, new TextEncoder().encode("plain"))).status).toBe(400); // not an Eva backup file
    expect((await put(name, file)).status).toBe(200);
    const listed = (await body(await call("/admin/backups", { token: ADMIN }))) as { backups: Array<{ name: string; size: number }> };
    expect(listed.backups).toEqual([expect.objectContaining({ name, size: 7 })]);
    const got = await call(`/admin/backups/${name}`, { token: ADMIN });
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(file);
    expect((await call(`/admin/backups/${name}`, { method: "DELETE", token: ADMIN })).status).toBe(200);
    expect(store.size).toBe(0);
    env.BACKUPS = undefined;
    expect((await call("/admin/backups", { token: ADMIN })).status).toBe(503);
  });
});
