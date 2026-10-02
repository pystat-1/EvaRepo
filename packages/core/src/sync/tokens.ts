// Random tokens and content hashes for the sync (sessions, versions).
// Evaluators sign in with Google, so no passwords live here.
// Works anywhere WebCrypto exists: browser, Tauri webview, Workers, Node.

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** SHA-256 hex of a string: content versions and session-token storage. */
export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A random URL-safe token (sessions, admin key). */
export function randomToken(): string {
  const safe: Record<string, string> = { "+": "-", "/": "_", "=": "" };
  return b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => safe[c]);
}
