// Verifies a Google Sign-In ID token (a JWT signed by Google, RS256) with
// WebCrypto: signature against Google's published keys, then issuer,
// audience (our client ID), expiry and a verified email. No Google SDK and
// no client secret: the ID-token flow only needs the public client ID.

export interface GoogleIdentity {
  email: string;
  name: string | null;
  sub: string;
}

export type KeyLookup = (kid: string) => Promise<JsonWebKey | null>;

const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const SKEW = 300; // seconds of clock difference tolerated

export class GoogleTokenError extends Error {}

function b64urlBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlJson = <T>(s: string): T => JSON.parse(new TextDecoder().decode(b64urlBytes(s))) as T;

export async function verifyGoogleIdToken(token: string, clientId: string, keyFor: KeyLookup, nowSec = Date.now() / 1000): Promise<GoogleIdentity> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new GoogleTokenError("رمز غير صالح");
  let header: { alg?: string; kid?: string };
  let claims: { iss?: string; aud?: string; exp?: number; iat?: number; email?: string; email_verified?: boolean | string; name?: string; sub?: string };
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    throw new GoogleTokenError("رمز غير صالح");
  }
  if (header.alg !== "RS256" || !header.kid) throw new GoogleTokenError("رمز غير صالح");
  const jwk = await keyFor(header.kid);
  if (!jwk) throw new GoogleTokenError("رمز غير صالح");
  const key = await crypto.subtle.importKey("jwk", { ...jwk, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlBytes(parts[2]) as BufferSource,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`) as BufferSource
  );
  if (!ok) throw new GoogleTokenError("رمز غير صالح");
  if (!claims.iss || !ISSUERS.has(claims.iss)) throw new GoogleTokenError("رمز من جهة غير Google");
  if (claims.aud !== clientId) throw new GoogleTokenError("رمز لتطبيق آخر");
  if (typeof claims.exp !== "number" || claims.exp + SKEW < nowSec) throw new GoogleTokenError("انتهت صلاحية الدخول — حاول مجددًا");
  if (typeof claims.iat === "number" && claims.iat - SKEW > nowSec) throw new GoogleTokenError("رمز غير صالح");
  if (!claims.email || !(claims.email_verified === true || claims.email_verified === "true")) throw new GoogleTokenError("بريد حساب Google غير مؤكَّد");
  return { email: claims.email.toLowerCase(), name: claims.name ?? null, sub: String(claims.sub ?? "") };
}

// Google's signing keys, cached in the Worker isolate for as long as Google
// says (Cache-Control max-age); an unknown kid forces a refresh, at most
// once a minute.
let cache: { keys: Map<string, JsonWebKey>; until: number; fetchedAt: number } | null = null;

export const googleKeys: KeyLookup = async (kid) => {
  const t = Date.now();
  if (!cache || t > cache.until || (!cache.keys.has(kid) && t - cache.fetchedAt > 60_000)) {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    if (!res.ok) throw new Error(`google certs ${res.status}`);
    const { keys } = (await res.json()) as { keys: Array<JsonWebKey & { kid: string }> };
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
    cache = { keys: new Map(keys.map((k) => [k.kid, k])), until: t + maxAge * 1000, fetchedAt: t };
  }
  return cache.keys.get(kid) ?? null;
};
