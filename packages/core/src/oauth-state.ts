import { decrypt, encrypt, type KeyRing } from "./crypto";

export interface OAuthState { uid: string; provider: string; level: string; verifier: string; exp: number }

/** State is sealed (encrypted + authenticated), so it carries the PKCE verifier safely and can't be forged (CSRF). */
export const sealState = (ring: KeyRing, s: Omit<OAuthState, "exp">, ttlMs = 10 * 60_000, now = Date.now()) =>
  encrypt(ring, JSON.stringify({ ...s, exp: now + ttlMs }));

export function openState(ring: KeyRing, sealed: string, now = Date.now()): OAuthState {
  const s = JSON.parse(decrypt(ring, sealed)) as OAuthState; // throws on tamper
  if (s.exp < now) throw new Error("state expired");
  return s;
}
