import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM. Keys are versioned so they can be rotated: keys = { "1": <32 bytes>, "2": ... },
 * encrypt() uses `current`, decrypt() uses whichever version the ciphertext names.
 * Format: v<version>.<iv b64url>.<tag b64url>.<ciphertext b64url>
 */
export interface KeyRing { current: string; keys: Record<string, Buffer> }

export function keyRingFromEnv(b64: string, version = "1"): KeyRing {
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes (base64)");
  return { current: version, keys: { [version]: key } };
}

export function encrypt(ring: KeyRing, plaintext: string): string {
  const key = ring.keys[ring.current];
  if (!key) throw new Error("current key missing");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return ["v" + ring.current, iv, c.getAuthTag(), ct].map((p, i) => (i === 0 ? p : (p as Buffer).toString("base64url"))).join(".");
}

export function decrypt(ring: KeyRing, token: string): string {
  const [v, iv, tag, ct] = token.split(".");
  const key = v && ring.keys[v.slice(1)];
  if (!key || !iv || !tag || !ct) throw new Error("invalid ciphertext");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const hmacHex = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");
