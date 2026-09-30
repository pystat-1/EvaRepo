import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { hashPassword } from "@eva/core/sync/password";
import type { EvaluatorBundle } from "@eva/core/sync/contract";
import { handle, type DB, type Env, type Stmt } from "./relay";

// D1-shaped adapter over better-sqlite3 (D1 is SQLite, same SQL).
function d1(): DB {
  const db = new Database(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
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

async function publishSara(passwordHash: string, active = true) {
  return call("/admin/publish", {
    method: "PUT", token: ADMIN,
    body: JSON.stringify({ evaluators: [{ id: "e1", email: "Sara@X.iq", name: "د. سارة", passwordHash, active }], bundles: active ? [bundle("e1")] : [] }),
  });
}
async function loginSara(password: string) {
  return call("/api/login", { method: "POST", body: JSON.stringify({ email: "sara@x.iq", password }) });
}

describe("relay", () => {
  let hash: string;
  beforeEach(async () => {
    env = { DB: d1(), ADMIN_TOKEN: ADMIN };
    hash = await hashPassword("k7Qm-Xp3w-Tz9d");
  });

  it("admin endpoints need the admin key", async () => {
    expect((await call("/admin/status")).status).toBe(401);
    expect((await call("/admin/status", { token: "wrong" })).status).toBe(401);
    expect((await call("/admin/status", { token: ADMIN })).status).toBe(200);
  });

  it("login: right password gets a token; wrong ones fail and are rate-limited", async () => {
    await publishSara(hash);
    expect((await loginSara("nope")).status).toBe(401);
    const ok = await body(await loginSara("k7Qm-Xp3w-Tz9d"));
    expect(ok.evaluator).toEqual({ id: "e1", name: "د. سارة" });
    expect(typeof ok.token).toBe("string");
    for (let i = 0; i < 9; i++) await loginSara("nope");
    expect((await loginSara("k7Qm-Xp3w-Tz9d")).status).toBe(429);
  });

  it("serves the evaluator's bundle, with 304 when unchanged", async () => {
    await publishSara(hash);
    const { token } = (await body(await loginSara("k7Qm-Xp3w-Tz9d"))) as { token: string };
    const res = await call("/api/bundle", { token });
    expect(res.status).toBe(200);
    expect(((await res.json()) as EvaluatorBundle).evaluator.id).toBe("e1");
    expect((await call("/api/bundle", { token, headers: { "if-none-match": "v1" } })).status).toBe(304);
    expect((await call("/api/bundle")).status).toBe(401);
  });

  it("stores submissions under the session's evaluator, idempotently", async () => {
    await publishSara(hash);
    const { token } = (await body(await loginSara("k7Qm-Xp3w-Tz9d"))) as { token: string };
    const first = await body(await call("/api/submissions", { method: "POST", token, body: JSON.stringify({ submissions: [day("a"), { ...day("b"), dateISO: "bad" }] }) }));
    expect(first).toEqual({ accepted: ["a"], rejected: [{ clientId: "b", message: "تاريخ غير صالح" }] });
    await call("/api/submissions", { method: "POST", token, body: JSON.stringify({ submissions: [day("a")] }) }); // resend
    const listed = (await body(await call("/admin/submissions?after=0", { token: ADMIN }))) as { submissions: Array<{ seq: number; submission: { clientId: string; evaluatorId: string } }> };
    expect(listed.submissions).toHaveLength(1);
    expect(listed.submissions[0].submission).toMatchObject({ clientId: "a", evaluatorId: "e1" }); // not "spoofed"
    expect((await body(await call(`/admin/submissions?after=${listed.submissions[0].seq}`, { token: ADMIN }))).submissions).toEqual([]);
  });

  it("returns the desktop's decisions to the phone", async () => {
    await publishSara(hash);
    const { token } = (await body(await loginSara("k7Qm-Xp3w-Tz9d"))) as { token: string };
    await call("/api/submissions", { method: "POST", token, body: JSON.stringify({ submissions: [day("a")] }) });
    await call("/admin/results", { method: "POST", token: ADMIN, body: JSON.stringify({ results: [{ clientId: "a", outcome: "applied", message: "اعتُمد 1 تقييم" }] }) });
    const { results } = (await body(await call("/api/results", { token }))) as { results: Array<{ clientId: string; outcome: string }> };
    expect(results).toMatchObject([{ clientId: "a", outcome: "applied" }]);
  });

  it("a new password or deactivation signs the evaluator out", async () => {
    await publishSara(hash);
    const { token } = (await body(await loginSara("k7Qm-Xp3w-Tz9d"))) as { token: string };
    await publishSara(await hashPassword("new-pass-1234"));
    expect((await call("/api/bundle", { token })).status).toBe(401);
    expect((await loginSara("new-pass-1234")).status).toBe(200);
    await publishSara(await hashPassword("new-pass-1234"), false);
    expect((await loginSara("new-pass-1234")).status).toBe(401);
  });

  it("allows the desktop app's origin (CORS) on admin endpoints only", async () => {
    const pre = await call("/admin/status", { method: "OPTIONS", headers: { origin: "http://tauri.localhost" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
    expect((await call("/admin/status", { method: "OPTIONS", headers: { origin: "https://evil.example" } })).status).toBe(403);
    const res = await call("/admin/status", { token: ADMIN, headers: { origin: "http://tauri.localhost" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
  });
});
