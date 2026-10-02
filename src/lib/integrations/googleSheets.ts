// Grades backup transport to Google Sheets. Two modes, auto-detected from env:
//
//  1. WEBHOOK (recommended, and the only one that works on locked-down/
//     personal Google accounts): a Google Apps Script Web App bound to the
//     sheet. We POST JSON to its secret URL with a shared token; the script
//     writes to the sheet as the owner. No service-account key, no org
//     policy, no billing. See docs/google-sheets-backup for the script.
//
//  2. SERVICE ACCOUNT: signs a JWT with a service-account key (WebCrypto) and
//     calls the Sheets REST API directly. Kept for orgs that allow SA keys.
//
// Everything is a no-op when unconfigured, and every call is wrapped by the
// caller so a Sheets outage can never block grading.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export type SheetsConfig =
  | { mode: "webhook"; url: string; token: string }
  | { mode: "service_account"; spreadsheetId: string; clientEmail: string; privateKey: string };

export function getSheetsConfig(): SheetsConfig | null {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  const token = process.env.GOOGLE_SHEETS_TOKEN;
  if (url && token) return { mode: "webhook", url, token };

  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const clientEmail = process.env.GOOGLE_SA_EMAIL;
  const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY;
  if (spreadsheetId && clientEmail && privateKey) {
    return { mode: "service_account", spreadsheetId, clientEmail, privateKey: privateKey.replace(/\\n/g, "\n") };
  }
  return null;
}

export function isSheetsConfigured(): boolean {
  return getSheetsConfig() !== null;
}

// ---- Webhook transport (Apps Script Web App) ----

async function webhookPost(
  cfg: Extract<SheetsConfig, { mode: "webhook" }>,
  payload: Record<string, unknown>
): Promise<void> {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: cfg.token, ...payload }),
    redirect: "follow",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Apps Script ${res.status}: ${text.slice(0, 200)}`);
  // The script returns JSON {ok:true}; a token mismatch returns {ok:false}.
  try {
    const json = JSON.parse(text);
    if (json && json.ok === false) throw new Error(json.error || "رفض Apps Script الطلب (تحقّق من الرمز السري)");
  } catch (e) {
    if (e instanceof Error && e.message.includes("Apps Script")) throw e;
    // Non-JSON 200 (e.g. an auth/HTML page) means the Web App isn't
    // deployed for "Anyone" access.
    if (!text.includes("ok")) throw new Error("استجابة غير متوقعة من Apps Script — تأكّد من نشر التطبيق للوصول «Anyone».");
  }
}

// ---- Service-account transport (Sheets REST API) ----

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64urlJSON(obj: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}
function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

let tokenCache: { token: string; exp: number } | null = null;

async function getAccessToken(cfg: Extract<SheetsConfig, { mode: "service_account" }>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token;
  const header = { alg: "RS256", typ: "JWT" };
  const claim = { iss: cfg.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  const signingInput = `${base64urlJSON(header)}.${base64urlJSON(claim)}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(cfg.privateKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64url(new Uint8Array(sig))}`;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Google token error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, exp: now + (json.expires_in ?? 3600) };
  return json.access_token;
}

async function saApi(cfg: Extract<SheetsConfig, { mode: "service_account" }>, path: string, init: RequestInit): Promise<Response> {
  const token = await getAccessToken(cfg);
  const res = await fetch(`${SHEETS_API}/${cfg.spreadsheetId}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Sheets API ${res.status} on ${path}: ${await res.text()}`);
  return res;
}

async function saEnsureTabs(cfg: Extract<SheetsConfig, { mode: "service_account" }>, titles: string[]): Promise<void> {
  const meta = (await (await saApi(cfg, "?fields=sheets.properties.title", { method: "GET" })).json()) as {
    sheets?: { properties?: { title?: string } }[];
  };
  const existing = new Set((meta.sheets ?? []).map((s) => s.properties?.title));
  const toAdd = titles.filter((t) => !existing.has(t));
  if (toAdd.length === 0) return;
  await saApi(cfg, ":batchUpdate", { method: "POST", body: JSON.stringify({ requests: toAdd.map((title) => ({ addSheet: { properties: { title } } })) }) });
}

// ---- Public API (dispatches on transport) ----

export async function writeTab(cfg: SheetsConfig, tab: string, header: (string | number)[], rows: (string | number)[][]): Promise<void> {
  if (cfg.mode === "webhook") {
    await webhookPost(cfg, { action: "sync", tab, header, rows });
    return;
  }
  await saEnsureTabs(cfg, [tab]);
  await saApi(cfg, `/values/${encodeURIComponent(`${tab}!A:ZZ`)}:clear`, { method: "POST", body: "{}" });
  await saApi(cfg, `/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [header, ...rows] }) });
}

// A fully-formatted matrix render (values + merges + colors + bold), applied
// by the Apps Script's "render" action. Ranges are 1-indexed [row, col,
// numRows, numCols]; bg adds a hex color. Only supported on the webhook
// transport (the service-account path falls back to a plain values write).
export interface MatrixPayload {
  values: (string | number)[][];
  merges: [number, number, number, number][];
  bg: [number, number, number, number, string][];
  bold: [number, number, number, number][];
  freezeRows?: number;
  freezeCols?: number;
}

export async function writeMatrix(cfg: SheetsConfig, tab: string, p: MatrixPayload): Promise<void> {
  if (cfg.mode === "webhook") {
    await webhookPost(cfg, { action: "render", tab, ...p });
    return;
  }
  // Service-account fallback: write the values only (no formatting).
  await saEnsureTabs(cfg, [tab]);
  await saApi(cfg, `/values/${encodeURIComponent(`${tab}!A:ZZ`)}:clear`, { method: "POST", body: "{}" });
  await saApi(cfg, `/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: p.values }) });
}

export async function appendRows(cfg: SheetsConfig, tab: string, rows: (string | number)[][]): Promise<void> {
  if (rows.length === 0) return;
  if (cfg.mode === "webhook") {
    await webhookPost(cfg, { action: "append", tab, rows });
    return;
  }
  await saEnsureTabs(cfg, [tab]);
  await saApi(cfg, `/values/${encodeURIComponent(`${tab}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ values: rows }) });
}
