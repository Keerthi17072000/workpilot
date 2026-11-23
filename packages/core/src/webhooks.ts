import { hmacHex, safeEqual } from "./crypto";

/** Slack: v0=HMAC(secret, "v0:{ts}:{body}"), rejects timestamps older than 5 minutes (replay protection). */
export function verifySlackSignature(o: { secret: string; timestamp: string | undefined; signature: string | undefined; rawBody: string; now?: number }): boolean {
  if (!o.timestamp || !o.signature) return false;
  const ts = Number(o.timestamp);
  if (!Number.isFinite(ts) || Math.abs((o.now ?? Date.now() / 1000) - ts) > 300) return false;
  return safeEqual(o.signature, `v0=${hmacHex(o.secret, `v0:${o.timestamp}:${o.rawBody}`)}`);
}

/** GitHub: X-Hub-Signature-256 = sha256=HMAC(secret, body). */
export function verifyGithubSignature(o: { secret: string; signature: string | undefined; rawBody: string }): boolean {
  if (!o.signature) return false;
  return safeEqual(o.signature, `sha256=${hmacHex(o.secret, o.rawBody)}`);
}
