// Online backups are encrypted on this computer before they leave it:
// gzip, then AES-256-GCM with a random key that only the admin holds, shown
// as a recovery code. The storage (Cloudflare R2) only ever sees ciphertext.
//
// File format: "EVAB" | version (1 byte) | IV (12 bytes) | ciphertext+tag.
// The header is authenticated too (AES-GCM additional data).

const MAGIC = new TextEncoder().encode("EVAB");
const VERSION = 1;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols, no 0/O or 1/I

export class WrongKeyError extends Error {
  constructor() {
    super("رمز الاسترداد لا يطابق هذه النسخة");
  }
}

async function checksum(key: Uint8Array) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", key as BufferSource)).subarray(0, 3);
}

function toCode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join("-");
}

function fromCode(code: string): Uint8Array | null {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/I/g, "1");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return out.length === 35 ? new Uint8Array(out) : null;
}

/** A new random key, as the recovery code the admin keeps (14 groups of 4). */
export async function newRecoveryCode(): Promise<string> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return toCode(new Uint8Array([...key, ...(await checksum(key))]));
}

/** The key inside a recovery code; null if it was mistyped. */
export async function codeToKey(code: string): Promise<Uint8Array | null> {
  const raw = fromCode(code);
  if (!raw) return null;
  const key = raw.subarray(0, 32);
  const sum = await checksum(key);
  return sum.every((b, i) => b === raw[32 + i]) ? key : null;
}

async function aes(key: Uint8Array) {
  return crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function encryptBackup(plain: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = new Uint8Array([...MAGIC, VERSION, ...iv]);
  const zipped = await pipe(plain, new CompressionStream("gzip"));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: header }, await aes(key), zipped as BufferSource));
  const out = new Uint8Array(header.length + sealed.length);
  out.set(header);
  out.set(sealed, header.length);
  return out;
}

export async function decryptBackup(file: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  if (file.length < 17 + 16 || !MAGIC.every((b, i) => file[i] === b) || file[4] !== VERSION) throw new Error("ملف نسخة غير معروف");
  const header = file.subarray(0, 17);
  let zipped: ArrayBuffer;
  try {
    zipped = await crypto.subtle.decrypt({ name: "AES-GCM", iv: file.subarray(5, 17) as BufferSource, additionalData: header as BufferSource }, await aes(key), file.subarray(17) as BufferSource);
  } catch {
    throw new WrongKeyError();
  }
  return pipe(new Uint8Array(zipped), new DecompressionStream("gzip"));
}
