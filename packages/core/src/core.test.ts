import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  authorize, buildAuthUrl, decrypt, defaultRegistry, dedupeKey, encrypt, getAccessToken, hmacHex, keyRingFromEnv,
  openState, ReauthRequiredError, scopesFor, sealState, verifyGithubSignature, verifySlackSignature,
  type TokenSet, type TokenStore,
} from "./index";

const ring = keyRingFromEnv(randomBytes(32).toString("base64"));
const reg = defaultRegistry();

describe("permissions", () => {
  it("denies when the integration cap is below the required level", () => {
    expect(authorize({ integrationLevel: "suggest", required: "execute", requireApproval: false, approved: true }))
      .toEqual({ allow: false, reason: "level_too_low" });
  });
  it("EXECUTE needs approval by default", () => {
    expect(authorize({ integrationLevel: "execute", required: "execute", requireApproval: true, approved: false }))
      .toEqual({ allow: false, reason: "approval_required" });
    expect(authorize({ integrationLevel: "execute", required: "execute", requireApproval: true, approved: true })).toEqual({ allow: true });
  });
  it("approval can be switched off by the user, but never bypasses the level cap", () => {
    expect(authorize({ integrationLevel: "execute", required: "execute", requireApproval: false, approved: false })).toEqual({ allow: true });
    expect(authorize({ integrationLevel: "read", required: "execute", requireApproval: false, approved: false }).allow).toBe(false);
  });
  it("READ/SUGGEST never need approval", () => {
    expect(authorize({ integrationLevel: "suggest", required: "suggest", requireApproval: true, approved: false })).toEqual({ allow: true });
  });
});

describe("crypto", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt(ring, "tok"), b = encrypt(ring, "tok");
    expect(a).not.toBe(b);
    expect(decrypt(ring, a)).toBe("tok");
  });
  it("rejects tampering and wrong keys", () => {
    const c = encrypt(ring, "tok");
    expect(() => decrypt(ring, c.slice(0, -2) + "AA")).toThrow();
    expect(() => decrypt(keyRingFromEnv(randomBytes(32).toString("base64")), c)).toThrow();
  });
  it("decrypts old key versions after rotation", () => {
    const old = encrypt(ring, "x");
    const rotated = { current: "2", keys: { ...ring.keys, "2": randomBytes(32) } };
    expect(decrypt(rotated, old)).toBe("x");
    expect(encrypt(rotated, "y").startsWith("v2.")).toBe(true);
  });
  it("rejects short keys", () => expect(() => keyRingFromEnv("c2hvcnQ=")).toThrow());
});

describe("webhook verification", () => {
  const secret = "s3cret", body = '{"a":1}', ts = "1700000000";
  const sig = `v0=${hmacHex(secret, `v0:${ts}:${body}`)}`;
  it("accepts a valid Slack signature", () =>
    expect(verifySlackSignature({ secret, timestamp: ts, signature: sig, rawBody: body, now: 1700000010 })).toBe(true));
  it("rejects bad signature, modified body, missing headers", () => {
    expect(verifySlackSignature({ secret, timestamp: ts, signature: "v0=00", rawBody: body, now: 1700000010 })).toBe(false);
    expect(verifySlackSignature({ secret, timestamp: ts, signature: sig, rawBody: body + " ", now: 1700000010 })).toBe(false);
    expect(verifySlackSignature({ secret, timestamp: undefined, signature: sig, rawBody: body })).toBe(false);
  });
  it("rejects replays older than 5 minutes", () =>
    expect(verifySlackSignature({ secret, timestamp: ts, signature: sig, rawBody: body, now: 1700000400 })).toBe(false));
  it("verifies GitHub signatures", () => {
    const s = `sha256=${hmacHex(secret, body)}`;
    expect(verifyGithubSignature({ secret, signature: s, rawBody: body })).toBe(true);
    expect(verifyGithubSignature({ secret: "other", signature: s, rawBody: body })).toBe(false);
  });
});

describe("dedupe keys", () => {
  it("is stable for the same event and distinct for different ones", () => {
    const e = { kind: "pr.review_requested", externalId: "42" };
    expect(dedupeKey("github", e)).toBe(dedupeKey("github", { ...e }));
    expect(dedupeKey("github", e)).not.toBe(dedupeKey("github", { ...e, discriminator: "round2" }));
    expect(dedupeKey("github", e)).not.toBe(dedupeKey("slack", e));
  });
});

describe("oauth", () => {
  it("requests minimum scopes per level", () => {
    const gmail = reg.get("gmail")!.oauth;
    expect(scopesFor(gmail, "read")).toEqual(["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"]);
    expect(scopesFor(gmail, "execute")).toContain("https://www.googleapis.com/auth/gmail.compose");
    expect(scopesFor(gmail, "suggest")).not.toContain("https://www.googleapis.com/auth/gmail.compose");
  });
  it("builds a PKCE auth URL for Google and a user_scope URL for Slack", () => {
    const u = new URL(buildAuthUrl(reg.get("gmail")!, { clientId: "cid", redirectUri: "http://x/cb", level: "read", state: "st", verifier: "v" }));
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("access_type")).toBe("offline");
    const s = new URL(buildAuthUrl(reg.get("slack")!, { clientId: "cid", redirectUri: "http://x/cb", level: "read", state: "st", verifier: "v" }));
    expect(s.searchParams.get("user_scope")).toContain("search:read");
    expect(s.searchParams.has("scope")).toBe(false);
  });
  it("sealed state round-trips, expires, and can't be forged", () => {
    const s = { uid: "u1", provider: "gmail", level: "read", verifier: "v" };
    const sealed = sealState(ring, s, 1000, 0);
    expect(openState(ring, sealed, 500)).toMatchObject(s);
    expect(() => openState(ring, sealed, 2000)).toThrow(/expired/);
    expect(() => openState(ring, sealed.slice(0, -2) + "AA", 500)).toThrow();
  });
});

describe("token refresh", () => {
  const mod = reg.get("gmail")!;
  const env = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "sec" };
  const memStore = (t: TokenSet | null) => {
    const st = { t, saved: [] as TokenSet[], reauth: [] as string[] };
    const store: TokenStore = {
      get: async () => st.t,
      save: async (_, n) => { st.t = n; st.saved.push(n); },
      markReauthRequired: async (_, r) => { st.reauth.push(r); },
    };
    return { st, store };
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const now = 1_000_000;

  it("returns the stored token without a network call while it is fresh", async () => {
    const { store } = memStore({ accessToken: "A", refreshToken: "R", expiresAt: new Date(now + 10 * 60_000) });
    const f = vi.fn();
    expect(await getAccessToken({ store, module: mod, integrationId: "i", env, fetch: f as any, now })).toBe("A");
    expect(f).not.toHaveBeenCalled();
  });
  it("refreshes near expiry, persists the new token and keeps the old refresh token if none is returned", async () => {
    const { store, st } = memStore({ accessToken: "A", refreshToken: "R", expiresAt: new Date(now + 30_000) });
    const f = vi.fn(async () => json(200, { access_token: "B", expires_in: 3600 }));
    expect(await getAccessToken({ store, module: mod, integrationId: "i", env, fetch: f as any, now })).toBe("B");
    expect(st.saved[0]).toMatchObject({ accessToken: "B", refreshToken: "R" });
    expect(String((f.mock.calls[0] as any)[1].body)).toContain("grant_type=refresh_token");
  });
  it("flags re-auth when the refresh token is rejected", async () => {
    const { store, st } = memStore({ accessToken: "A", refreshToken: "R", expiresAt: new Date(now - 1) });
    const f = async () => json(400, { error: "invalid_grant" });
    await expect(getAccessToken({ store, module: mod, integrationId: "i", env, fetch: f as any, now })).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(st.reauth).toEqual(["invalid_grant"]);
  });
  it("treats server errors as transient: no re-auth flag, error propagates for job retry", async () => {
    const { store, st } = memStore({ accessToken: "A", refreshToken: "R", expiresAt: new Date(now - 1) });
    const f = async () => json(503, { error: "unavailable" });
    await expect(getAccessToken({ store, module: mod, integrationId: "i", env, fetch: f as any, now })).rejects.not.toBeInstanceOf(ReauthRequiredError);
    expect(st.reauth).toEqual([]);
  });
});
